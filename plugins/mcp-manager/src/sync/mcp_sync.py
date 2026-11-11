"""Reconcile the portable portion of three user-level MCP configurations."""

import argparse
from collections.abc import Mapping
from contextlib import contextmanager
from dataclasses import dataclass, field
import fcntl
import hashlib
from io import StringIO
import json
from math import isfinite
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit

import tomlkit
from ruamel.yaml import YAML
from ruamel.yaml.error import YAMLError
from websockets.exceptions import WebSocketException
from websockets.sync.client import unix_connect


ENDS = ("codex", "claude", "deepseek")
NAME = re.compile(r"[A-Za-z0-9_-]{1,32}")
PATH_ENV = {"PATH", "JAVA_HOME", "GHIDRA_INSTALL_DIR"}
LOCAL_ONLY = {"node_repl"}
DEEPSEEK_CLIENT = "@deepseek-ai/dsh-mcp-client"
TIMEOUTS = {
    "codex": {"startup_timeout_sec", "tool_timeout_sec"},
    "claude": set(),
    "deepseek": {"startupTimeoutMs", "toolCallTimeoutMs", "closeTimeoutMs"},
}
RELATIVE = {
    "codex": ".codex/config.toml",
    "claude": ".claude.json",
    "deepseek": ".dsh/profiles/desktop/cordis.patch.yml",
}


class SyncError(Exception):
    """An error safe to print without exposing configuration contents."""


class NativeRemoveFailed(SyncError):
    def __init__(self, returncode):
        self.returncode = returncode


def native_remove_request(source, args, env):
    override = 'CODEX_HOME' if source == 'codex' else 'CLAUDE_CONFIG_DIR'
    if env.get(override) or args[:2] != ['mcp', 'remove']:
        return None
    rest = args[2:]
    if source == 'codex':
        name = rest[0] if len(rest) == 1 else None
    elif len(rest) == 2 and '--scope=user' in rest:
        name = rest[1] if rest[0] == '--scope=user' else rest[0]
    elif len(rest) == 3 and rest[0] in ('-s', '--scope') and rest[1] == 'user':
        name = rest[2]
    elif len(rest) == 3 and rest[1] in ('-s', '--scope') and rest[2] == 'user':
        name = rest[0]
    else:
        name = None
    return name if name and not name.startswith('-') and NAME.fullmatch(name) else None


def reload_codex(path):
    if not path.is_socket():
        return "offline"

    def request(connection, request_id, method, **params):
        message = {"id": request_id, "method": method}
        if params:
            message["params"] = params
        connection.send(json.dumps(message))
        deadline = time.monotonic() + 4
        while True:
            response = json.loads(connection.recv(timeout=max(0, deadline - time.monotonic())))
            if isinstance(response, dict) and response.get("id") == request_id:
                if "result" not in response:
                    raise SyncError("Codex rejected the MCP reload request")
                return
            if time.monotonic() >= deadline:
                raise TimeoutError

    try:
        with unix_connect(os.fspath(path), uri="ws://localhost/rpc", proxy=None, open_timeout=2,
                          close_timeout=1, ping_interval=None) as connection:
            request(connection, 1, "initialize", clientInfo={"name": "mcp_sync", "version": "2.0"})
            connection.send('{"method":"initialized"}')
            request(connection, 2, "config/mcpServer/reload")
    except (OSError, ValueError, WebSocketException) as error:
        raise SyncError("Codex MCP reload deferred") from error
    return "reloaded"


def require_desktop_client():
    app = Path("/Applications/DeepSeek Harness.app/Contents")
    packages = app / "Resources/app.asar/dsh/node_modules/@deepseek-ai"
    try:
        check = subprocess.run(
            [
                str(app / "MacOS/DeepSeek Harness"),
                "-e",
                'const f = require("node:fs"), p = process.argv[1];'
                'process.exit(f.existsSync(p + "/dsh-mcp-client/package.json") && '
                'f.existsSync(p + "/dsh-mcp-resources/package.json") ? 0 : 1)',
                str(packages),
            ],
            env={**os.environ, "ELECTRON_RUN_AS_NODE": "1"},
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
        )
        if check.returncode == 0:
            return
    except (OSError, subprocess.TimeoutExpired):
        pass
    raise SyncError("installed DeepSeek Harness lacks the desktop MCP client or resources")


def json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def read_regular(path):
    if not stat.S_ISREG(path.lstat().st_mode):
        raise SyncError("expected a regular file")
    return path.read_bytes()


def atomic_write(path, data, *, expected=None, mode=0o600):
    fd, temp = tempfile.mkstemp(prefix=f".{path.name}.mcp-sync-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            os.fchmod(handle.fileno(), mode)
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        if expected is not None and read_regular(path) != expected:
            raise SyncError("configuration changed before write")
        os.replace(temp, path)
        parent = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        Path(temp).unlink(missing_ok=True)


@contextmanager
def native_profile_lock(path):
    # Same exclusive create and PID format as dsh-atomic-write.
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as error:
        raise SyncError("DeepSeek profile is locked") from error
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(f"{os.getpid()}\n")
        yield
    finally:
        path.unlink()


def portable_string(value):
    # Templates are interpreted differently by the three clients.
    return isinstance(value, str) and "\0" not in value and ("$" + "{") not in value


def normalize(end, entry):
    if not isinstance(entry, Mapping):
        raise SyncError("invalid entry")
    kind_field = {"codex": None, "claude": "type", "deepseek": "transport"}[end]
    inferred = "stdio" if "command" in entry else "http"
    kind = entry.get(kind_field, inferred) if kind_field else inferred
    if end == "deepseek" and kind == "streamable-http":
        kind = "http"
    if kind not in ("stdio", "http"):
        raise SyncError("unsupported transport")
    enabled = entry.get("enabled", True)
    if not isinstance(enabled, bool) or (end == "claude" and "enabled" in entry):
        raise SyncError("unsupported enable setting")

    fields = {"enabled"} | TIMEOUTS[end]
    if kind_field:
        fields.add(kind_field)
    result = {"type": str(kind)}
    if kind == "stdio":
        fields |= {"command", "args", "env"}
        command = entry.get("command")
        args = entry.get("args", [])
        env = entry.get("env", {})
        if (
            not portable_string(command)
            or not command
            or ("/" in command and not command.startswith("/"))
            or not isinstance(args, list)
            or not all(portable_string(arg) for arg in args)
            or not isinstance(env, Mapping)
            or any(key not in PATH_ENV or not portable_string(value) for key, value in env.items())
        ):
            raise SyncError("unsupported command, arguments or environment")
        result["command"] = str(command)
        if args:
            result["args"] = [str(arg) for arg in args]
        if env:
            result["env"] = {str(key): str(value) for key, value in env.items()}
    else:
        fields |= {"url", "headers"} if end != "codex" else {"url", "http_headers"}
        url = entry.get("url")
        if not portable_string(url) or any(char.isspace() for char in url):
            raise SyncError("invalid HTTP URL")
        address = urlsplit(url)
        address.port
        if (
            address.scheme not in ("http", "https")
            or not address.hostname
            or address.username is not None
            or address.query
            or address.fragment
            or entry.get("headers", {})
            or entry.get("http_headers", {})
        ):
            raise SyncError("HTTP URL or headers require local configuration")
        result["url"] = str(url)
    if entry.keys() - fields:
        raise SyncError("client-specific configuration or policy")
    return result


def native_fields(end, value):
    result = {key: value[key] for key in ("command", "args", "env", "url") if key in value}
    if end == "claude":
        result["type"] = value["type"]
    elif end == "deepseek":
        result["transport"] = {"http": "streamable-http", "stdio": "stdio"}[value["type"]]
    return result


def local_settings(end, entry):
    result = {key: value for key, value in entry.items()
              if key in TIMEOUTS[end] and not isinstance(value, bool)
              and (isinstance(value, int) or isinstance(value, float) and isfinite(value)) and value >= 0}
    key = {"codex": "enabled", "deepseek": "disabled"}.get(end)
    if key in entry and isinstance(entry[key], bool):
        result[key] = entry[key]
    return result


def deepseek_rows(doc):
    if not isinstance(doc, list):
        raise ValueError("expected profile patch sequence")
    entries, skipped, reserved_ids = {}, {}, set()
    overrides = {block.get("id") for block in doc if isinstance(block, Mapping) and isinstance(block.get("id"), str)}
    reserved_ids.update(overrides)
    ids = set()
    duplicate_ids = set()
    for block in doc:
        if not isinstance(block, Mapping):
            continue
        rows = block.get("insert", [])
        if not isinstance(rows, list):
            raise ValueError("expected insert sequence")
        for row in rows:
            if not isinstance(row, Mapping):
                continue
            row_id = row.get("id")
            if isinstance(row_id, str):
                if row_id in ids:
                    duplicate_ids.add(row_id)
                ids.add(row_id)
            if row.get("name") != DEEPSEEK_CLIENT:
                continue
            config = row.get("config")
            name = config.get("serverName") if isinstance(config, Mapping) else None
            if not isinstance(name, str):
                raise ValueError("missing literal MCP serverName")
            if name in entries or name in skipped:
                skipped[name] = "duplicate service name in the desktop profile"
            elif (
                block.keys() != {"insert"}
                or row.keys() - {"id", "name", "config", "disabled"}
                or not isinstance(row_id, str)
                or row_id in overrides
                or not isinstance(row.get("disabled", False), bool)
                or "enabled" in config
            ):
                skipped[name] = "profile override, conditional state or unsupported patch entry"
            else:
                entries[name] = (block, row)
        if block.get("name") == DEEPSEEK_CLIENT:
            config = block.get("config")
            name = config.get("serverName") if isinstance(config, Mapping) else None
            if isinstance(name, str):
                skipped[name] = "profile entry requires a top-level insert"
            elif block.get("id") not in ids:
                raise ValueError("cannot resolve an MCP profile override")
    for name, (_, row) in entries.items():
        if row["id"] in duplicate_ids:
            skipped[name] = "duplicate Cordis row ID"
    return entries, skipped, reserved_ids | ids


def update_fields(entry, fields, local):
    for key in list(entry):
        if key not in fields and key not in local:
            del entry[key]
    for key, item in fields.items():
        if entry.get(key) != item:
            entry[key] = item


def update_deepseek(doc, updates, restore_options):
    entries, skipped, reserved = deepseek_rows(doc)
    additions = []
    for name, value in updates.items():
        if name in skipped:
            raise SyncError("cannot modify a local DeepSeek entry")
        if value is None:
            if name in entries:
                block, row = entries[name]
                block["insert"].remove(row)
                if not block["insert"]:
                    doc.remove(block)
            continue
        fields = {"serverName": name, **native_fields("deepseek", value)}
        if name in entries:
            _, row = entries[name]
            update_fields(row["config"], fields, TIMEOUTS["deepseek"])
        else:
            local = local_settings("deepseek", restore_options.get(name, {}))
            fields.update({k: v for k, v in local.items() if k != "disabled"})
            row_id = f"mcp-sync-{name}"
            suffix = 2
            while row_id in reserved:
                row_id = f"mcp-sync-{name}-{suffix}"
                suffix += 1
            reserved.add(row_id)
            row = {"id": row_id, "name": DEEPSEEK_CLIENT, "config": fields}
            if "disabled" in local:
                row["disabled"] = local["disabled"]
            additions.append(row)
    if additions:
        doc.append({"insert": additions})


@dataclass
class Snapshot:
    raw: bytes
    portable: dict
    skipped: dict
    local_options: dict = field(default_factory=dict)
    row_ids: dict = field(default_factory=dict)

    def removal_key(self, name):
        if name not in self.portable:
            return None
        encoded = json.dumps([self.portable[name], self.local_options.get(name), self.row_ids.get(name)],
                             sort_keys=True).encode()
        return hashlib.sha256(encoded).hexdigest()

    def matches(self, end, name, target):
        return self.portable.get(name) == target

    def legacy_removal_key(self, end, name):
        value = self.portable.get(name)
        if value is None:
            return None
        local = self.local_options.get(name, {})
        enabled = local.get("enabled", True) if end == "codex" else not local.get("disabled", False) if end == "deepseek" else True
        value = dict(value, enabled=enabled)
        options = {k: v for k, v in local.items() if k in TIMEOUTS[end]}
        return hashlib.sha256(json.dumps([value, options, self.row_ids.get(name)], sort_keys=True).encode()).hexdigest()


class Adapter:
    def __init__(self, end, path):
        self.end = end
        self.path = path
        self.yaml = YAML(typ="rt")
        self.yaml.preserve_quotes = True
        self.yaml.indent(mapping=2, sequence=2, offset=0)

    def parse(self, raw):
        text = raw.decode("utf-8")
        if self.end == "codex":
            return tomlkit.parse(text)
        if self.end == "claude":
            return json.loads(text, object_pairs_hook=json_object)
        return self.yaml.load(text)

    def entries(self, doc, *, create=False):
        parent = doc
        key = "mcp_servers" if self.end == "codex" else "mcpServers"
        if not isinstance(parent, Mapping):
            raise ValueError("expected mapping")
        entries = parent.setdefault(key, tomlkit.table() if self.end == "codex" else {}) if create else parent.get(key, {})
        if not isinstance(entries, Mapping):
            raise ValueError("expected MCP mapping")
        return entries

    def decode(self, raw):
        skipped = {}
        row_ids = {}
        try:
            doc = self.parse(raw)
            if self.end == "deepseek":
                rows, skipped, _ = deepseek_rows(doc)
                entries = {}
                for name, (_, row) in rows.items():
                    row_ids[name] = row['id']
                    entry = dict(row["config"])
                    entry.pop("serverName")
                    entry["enabled"] = not row.get("disabled", False)
                    entries[name] = entry
            else:
                entries = self.entries(doc)
        except (ValueError, TypeError, YAMLError, tomlkit.exceptions.TOMLKitError) as error:
            raise SyncError(f"{self.end}: invalid configuration structure") from error
        portable = {}
        for name, entry in entries.items():
            if not isinstance(name, str):
                raise SyncError(f"{self.end}: MCP name must be a string")
            if name in skipped:
                continue
            if not NAME.fullmatch(name):
                skipped[name] = "unsupported service name"
                continue
            if name in LOCAL_ONLY:
                skipped[name] = "reserved local service"
                continue
            try:
                portable[name] = normalize(self.end, entry)
            except (SyncError, ValueError) as error:
                skipped[name] = str(error) if isinstance(error, SyncError) else "invalid HTTP URL"
        options = {name: local_settings(self.end, entries[name]) for name in portable}
        if self.end == "deepseek":
            for name in portable:
                row = rows[name][1]
                if "disabled" in row:
                    options[name]["disabled"] = row["disabled"]
        return Snapshot(raw, portable, skipped, options, row_ids)

    def read(self):
        try:
            return self.decode(read_regular(self.path))
        except OSError as error:
            raise SyncError(f"{self.end}: cannot read configuration") from error

    def render(self, snapshot, updates, *, restore_options=None):
        doc = self.parse(snapshot.raw)
        restore_options = restore_options or {}
        if self.end == "deepseek":
            update_deepseek(doc, updates, restore_options)
        else:
            entries = self.entries(doc, create=True)
            for name, value in updates.items():
                if value is None:
                    entries.pop(name, None)
                    continue
                fields = native_fields(self.end, value)
                if name in entries:
                    update_fields(entries[name], fields, TIMEOUTS[self.end] | ({"enabled"} if self.end == "codex" else set()))
                elif self.end == "codex":
                    entry = tomlkit.table()
                    entry.update(fields)
                    entry.update(local_settings(self.end, restore_options.get(name, {})))
                    entries[name] = entry
                else:
                    entries[name] = fields
        if self.end == "codex":
            text = tomlkit.dumps(doc)
        elif self.end == "claude":
            text = json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
        else:
            output = StringIO()
            self.yaml.dump(doc, output)
            text = output.getvalue()
        raw = text.encode("utf-8")
        after = self.decode(raw)
        expected = snapshot.portable.copy()
        for name, value in updates.items():
            if value is None:
                expected.pop(name, None)
            else:
                expected[name] = value
        if (after.portable != expected or after.skipped != snapshot.skipped
                or any(not after.matches(self.end, name, value) for name, value in updates.items())):
            raise SyncError(f"{self.end}: verification of proposed configuration failed")
        return raw

    def write(self, snapshot, updates, *, restore_options=None):
        raw = self.render(snapshot, updates, restore_options=restore_options)
        mode = stat.S_IMODE(self.path.lstat().st_mode)
        if self.end == "deepseek":
            with native_profile_lock(self.path.parent / "package.json.lock"):
                atomic_write(self.path, raw, expected=snapshot.raw, mode=mode)
        else:
            atomic_write(self.path, raw, expected=snapshot.raw, mode=mode)


class Sync:
    def __init__(self, home, state_dir, *, refresh_codex=None):
        self.refresh_codex = refresh_codex
        self.adapters = {end: Adapter(end, home / RELATIVE[end]) for end in ENDS}
        self.state_path = state_dir / "state.json"

    def load(self):
        try:
            state = json.loads(read_regular(self.state_path), object_pairs_hook=json_object)
            if state["version"] not in (1, 2, 3, 4) or not all(
                isinstance(state[key], dict) for key in ("base", "pending")
            ):
                raise ValueError
            if state["version"] >= 3 and not all(
                isinstance(state.get(key, {}), dict) for key in ("removed", "local_options")
            ):
                raise ValueError
            return state
        except FileNotFoundError:
            return {"version": 4, "base": {}, "pending": {}}
        except (ValueError, TypeError, KeyError) as error:
            raise SyncError("invalid synchronization state") from error

    def save(self, state):
        atomic_write(self.state_path, (json.dumps(state, ensure_ascii=False, sort_keys=True) + "\n").encode())

    def guarded_remove(self, name, source, *, native=None, patch_path=None, revision=None):
        """Handle explicit removal while the caller owns the synchronization lock."""
        if not NAME.fullmatch(name):
            return 'unmanaged'
        state = self.load()
        baseline = state['base'].get(name)
        intent = state['pending'].get(name)
        if (baseline is None and intent is None) or name in LOCAL_ONLY:
            if native is None:
                return 'unmanaged'
            result = native()
            if result:
                raise NativeRemoveFailed(result)
            return 'local'

        origin = self.adapters[source]
        try:
            snapshots = {end: adapter.read() for end, adapter in self.adapters.items()}
            if source == 'deepseek' and (
                patch_path != origin.path or hashlib.sha256(snapshots[source].raw).hexdigest() != revision
            ):
                return 'conflict'
        except (OSError, SyncError):
            return 'unavailable'

        migrate_state(state, snapshots)
        baseline, intent = state['base'].get(name), state['pending'].get(name)
        if intent and intent.get('migration_conflict'):
            return 'conflict'
        before = current_values(snapshots, name)
        if any(name in snap.skipped for snap in snapshots.values()):
            return 'conflict'
        if intent is not None:
            if intent['target'] is not None or removal_conflicts(snapshots, name, intent):
                return 'conflict'
            if any(value not in (None, intent['before'][end]) for end, value in before.items()):
                return 'conflict'
            if native is None or before[source] is None:
                return self.finish_removal(name)
        elif before[source] is None or any(value not in (None, baseline) for value in before.values()):
            return 'conflict'
        try:
            if any(read_regular(self.adapters[end].path) != snap.raw for end, snap in snapshots.items()):
                return 'conflict'
        except (OSError, SyncError):
            return 'unavailable'

        if native is not None:
            result = native()
            if result:
                raise NativeRemoveFailed(result)
            try:
                updated = origin.read()
            except SyncError:
                return 'unavailable'
            if name in updated.portable or name in updated.skipped:
                return 'conflict'

        if intent is None:
            intent = {'target': None, 'before': before,
                      'expected_entries': {end: snap.removal_key(name) for end, snap in snapshots.items()}}
            if source == 'deepseek':
                intent['profile_revision'] = revision
            state['pending'][name] = intent
            self.save(state)
        return self.finish_removal(name)

    def finish_removal(self, name):
        try:
            report = self.run(only=name)
        except (OSError, SyncError):
            return 'pending'
        if name in report['conflicts'] or name in report['skipped']:
            return 'conflict'
        return 'pending' if name in report['pending'] else 'removed'

    def run(self, *, dry_run=False, resolve=None, remove=None, only=None):
        state = self.load()
        snapshots = {end: adapter.read() for end, adapter in self.adapters.items()}
        migrating = migrate_state(state, snapshots)
        base, pending = state["base"], state["pending"]
        removed = state.setdefault("removed", {})
        saved_options = state.setdefault("local_options", {})
        original_pending = sorted(pending)
        names = set(base) | set(pending)
        for snapshot in snapshots.values():
            names.update(snapshot.portable)
            names.update(snapshot.skipped)
        if only is not None:
            names.intersection_update({only})
        report = {"changes": {}, "conflicts": {}, "reappeared": {}, "skipped": {}, "errors": {}, "pending": []}
        if resolve and resolve[0] not in names:
            raise SyncError("unknown service")
        if remove is not None:
            if remove not in base and remove not in pending and remove not in removed:
                raise SyncError("only a managed service can be removed")
            names.add(remove)
        updates = {end: {} for end in ENDS}
        active = {}
        state_changed = migrating
        for end, snapshot in snapshots.items():
            options = saved_options.setdefault(end, {})
            for name, value in snapshot.local_options.items():
                if only is not None and name != only:
                    continue
                if name in removed and name not in pending and not (resolve and resolve[0] == name):
                    continue
                if options.get(name, {}) != value:
                    if value:
                        options[name] = value
                    else:
                        options.pop(name, None)
                    state_changed = True

        for name in sorted(names):
            selecting = bool(resolve and resolve[0] == name)
            removing = remove == name
            skipped = {end: snap.skipped[name] for end, snap in snapshots.items() if name in snap.skipped}
            if skipped:
                if selecting or removing:
                    raise SyncError("service has incompatible configuration")
                report["skipped"][name] = skipped
                continue
            baseline = base.get(name)
            current = current_values(snapshots, name)
            if pending.get(name, {}).get("migration_conflict") and not selecting:
                report["conflicts"][name] = ["unverified previous operation"]
                continue
            if selecting:
                target = current[resolve[1]]
                if target is None:
                    raise SyncError("selected client has no service definition; use remove for deletion")
            elif removing:
                target = None
            elif name in pending:
                intent = pending[name]
                target = intent["target"]
                divergence = removal_conflicts(snapshots, name, intent) or [
                    end for end in ENDS
                    if current[end] not in (intent["before"][end], target)
                    and current[end] is not None
                    and not snapshots[end].matches(end, name, target)
                ]
                if divergence:
                    report["conflicts"][name] = divergence
                    continue
            elif name in removed:
                report["reappeared"][name] = [end for end in ENDS if current[end] is not None]
                continue
            else:
                changed = [end for end in ENDS if current[end] is not None and current[end] != baseline]
                if changed:
                    target = current[changed[0]]
                    if any(current[end] != target for end in changed[1:]):
                        report["conflicts"][name] = changed
                        continue
                else:
                    if baseline is None or all(snap.matches(end, name, baseline) for end, snap in snapshots.items()):
                        continue
                    target = baseline

            active[name] = target
            affected = [end for end in ENDS if not snapshots[end].matches(end, name, target)]
            if affected:
                report["changes"][name] = affected
                for end in affected:
                    updates[end][name] = target
            if selecting or removing or (name not in pending and affected):
                before = current
                if removing and baseline is not None:
                    before = {end: value if value is not None else baseline for end, value in current.items()}
                pending[name] = {"before": before, "target": target}
                state_changed = True

        if dry_run:
            report["pending"] = original_pending
            return report
        if any(updates.values()) and any(
            read_regular(self.adapters[end].path) != snapshot.raw
            for end, snapshot in snapshots.items()
        ):
            raise SyncError("configuration changed during reconciliation")
        if self.refresh_codex is not None and updates["codex"] and "codex_reloaded" in state:
            del state["codex_reloaded"]
            state_changed = True
        if state_changed:
            self.save(state)
        profile_removals = {name for name in updates['deepseek'] if pending[name].get('profile_revision')}
        write_order = ('deepseek', 'codex', 'claude') if profile_removals else ENDS
        for end in write_order:
            changes = updates[end]
            if changes:
                try:
                    self.adapters[end].write(snapshots[end], changes, restore_options=saved_options[end])
                except (SyncError, OSError):
                    report["errors"][end] = "write deferred"
                    if end == 'deepseek':
                        for name in profile_removals:
                            updates['codex'].pop(name, None)
                            updates['claude'].pop(name, None)
        verified = snapshots
        if active:
            verified = {end: adapter.read() for end, adapter in self.adapters.items()}
            for name, target in active.items():
                if any(name in snap.skipped or not snap.matches(end, name, target)
                       for end, snap in verified.items()):
                    continue
                if target is None:
                    base.pop(name, None)
                    removed[name] = True
                    for options in saved_options.values():
                        options.pop(name, None)
                else:
                    base[name] = target
                    removed.pop(name, None)
                pending.pop(name, None)
            self.save(state)
        if self.refresh_codex is not None:
            codex_mcp = json.dumps(verified["codex"].portable, sort_keys=True).encode()
            fingerprint = hashlib.sha256(codex_mcp).hexdigest()
            if fingerprint != state.get("codex_reloaded"):
                try:
                    report["codex_runtime"] = self.refresh_codex()
                except (OSError, SyncError):
                    report["errors"]["codex_runtime"] = "reload deferred"
                else:
                    if report["codex_runtime"] == "reloaded":
                        state["codex_reloaded"] = fingerprint
                        self.save(state)
        report["pending"] = sorted(pending)
        return report


def current_values(snapshots, name):
    return {end: snap.portable.get(name) for end, snap in snapshots.items()}


def migrate_state(state, snapshots):
    if state["version"] == 4:
        return False
    def definition(value):
        return {k: v for k, v in value.items() if k != "enabled"} if value is not None else None
    for name, intent in state["pending"].items():
        expected = intent.get("expected_entries", {})
        # Unverified deletion remains reviewable; never replay or silently discard it.
        if intent["target"] is None and (state["version"] < 3 or set(expected) != set(ENDS)):
            intent["migration_conflict"] = True
        for end, token in list(expected.items()):
            snapshot = snapshots[end]
            if name not in snapshot.portable:
                continue
            if snapshot.legacy_removal_key(end, name) == token:
                expected[end] = snapshot.removal_key(name)
            else:
                intent["migration_conflict"] = True
        intent["target"] = definition(intent["target"])
        intent["before"] = {end: definition(value) for end, value in intent["before"].items()}
    state["base"] = {name: definition(value) for name, value in state["base"].items()}
    state.pop("claude_disabled_projects", None)
    state.pop("legacy_claude_absent", None)
    state["version"] = 4
    return True


def removal_conflicts(snapshots, name, intent):
    expected = intent.get('expected_entries', {})
    conflicts = [end for end, snapshot in snapshots.items() if end in expected and name in snapshot.portable
                 and snapshot.removal_key(name) != expected[end]]
    revision = intent.get('profile_revision')
    deepseek = snapshots['deepseek']
    if (revision and 'deepseek' not in conflicts and name in deepseek.portable
            and hashlib.sha256(deepseek.raw).hexdigest() != revision):
        conflicts.append('deepseek')
    return conflicts


def removal_exit(status, *, structured):
    if structured:
        print(json.dumps({'status': status}))
    elif status != 'local':
        messages = {
            'removed': '已从三端配置移除 MCP。',
            'pending': '已记录卸载，等待后台同步。',
            'conflict': '共享 MCP 配置存在冲突。请检查同步状态后重试。',
            'unavailable': '暂时无法确认三端配置。请检查同步状态后重试。',
            'unmanaged': '此 MCP 不在共享同步范围内。',
        }
        print(messages[status], file=sys.stderr if status != 'removed' else sys.stdout)
    return 0 if status in ('removed', 'local') or structured and status == 'pending' else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=Path.home())
    parser.add_argument("--state-dir", type=Path)
    commands = parser.add_subparsers(dest="command", required=True)
    sync = commands.add_parser("sync")
    sync.add_argument("--dry-run", action="store_true")
    sync.add_argument("--quiet", action="store_true")
    commands.add_parser("status")
    resolve = commands.add_parser("resolve")
    resolve.add_argument("name")
    resolve.add_argument("--from", dest="end", required=True, choices=ENDS)
    remove = commands.add_parser("remove", help="Remove a managed service from all clients.")
    remove.add_argument("name")
    profile_remove = commands.add_parser('remove-from-profile', help='Remove a managed service from the desktop profile.')
    profile_remove.add_argument('--patch-path', type=Path, required=True)
    profile_remove.add_argument('--revision', required=True)
    profile_remove.add_argument('name')
    native_remove = commands.add_parser('native-remove', help='Run an explicit native removal and synchronize it.')
    native_remove.add_argument('source', choices=('codex', 'claude'))
    native_remove.add_argument('binary', type=Path)
    native_remove.add_argument('native_args', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    os.umask(0o077)
    state_dir = args.state_dir or args.home / ".agents/mcp-sync"
    live = args.home.resolve() == Path.home().resolve()
    codex_socket = args.home / ".codex/app-server-control/app-server-control.sock"
    bridge = Sync(args.home, state_dir, refresh_codex=(lambda: reload_codex(codex_socket)) if live else None)
    structured = args.command == 'remove-from-profile'
    try:
        if args.command == 'native-remove':
            if not args.binary.is_absolute():
                raise SyncError('Expected an absolute native CLI path')
            command = [str(args.binary), *args.native_args]
            native_name = native_remove_request(args.source, args.native_args, os.environ)
            if native_name is None:
                return subprocess.run(command).returncode

        with (state_dir / "sync.lock").open("a") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            if structured:
                status = bridge.guarded_remove(args.name, 'deepseek', patch_path=args.patch_path, revision=args.revision)
                return removal_exit(status, structured=True)
            if args.command == 'native-remove':
                status = bridge.guarded_remove(native_name, args.source,
                                               native=lambda: subprocess.run(command, timeout=25).returncode)
                return removal_exit(status, structured=False)
            dry_run = args.command == "status" or getattr(args, "dry_run", False)
            if not dry_run and live and not bridge.state_path.exists():
                require_desktop_client()
            choice = (args.name, args.end) if args.command == "resolve" else None
            report = bridge.run(dry_run=dry_run, resolve=choice, remove=args.name if args.command == "remove" else None)
        if not getattr(args, "quiet", False) or report["errors"] or report["changes"] or report.get("codex_runtime") == "reloaded":
            print(json.dumps(report, ensure_ascii=False, sort_keys=True))
        return int(bool(report["errors"]))
    except NativeRemoveFailed as error:
        return error.returncode if error.returncode >= 0 else 128 - error.returncode
    except subprocess.TimeoutExpired:
        print('原生卸载命令超时，未确认共享删除。', file=sys.stderr)
        return 1
    except SyncError as error:
        if structured:
            return removal_exit('unavailable', structured=True)
        print(error, file=sys.stderr)
        return 1
    except OSError:
        if structured:
            return removal_exit('unavailable', structured=True)
        print("MCP synchronization I/O failure", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
