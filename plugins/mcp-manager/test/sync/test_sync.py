import json
from hashlib import sha256
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from mcp_sync import Sync, SyncError


def server(port=8100):
    return {"type": "http", "url": f"http://127.0.0.1:{port}/mcp"}


class SyncFixture(unittest.TestCase):
    def setUp(self):
        root = tempfile.TemporaryDirectory()
        self.addCleanup(root.cleanup)
        self.home = Path(root.name)
        (self.home / "state").mkdir()
        self.sync = Sync(self.home, self.home / "state")
        for adapter in self.sync.adapters.values():
            adapter.path.parent.mkdir(parents=True, exist_ok=True)
        self.put("codex", '# comment\nmodel = "test"\n')
        self.put("claude", '{"projects":{"/a":{"mcpServers":{"local":{}}}},"onboarding":true}\n')
        self.put("deepseek", '- id: unrelated\n  config:\n    key: !!js sample\n')

    def put(self, end, raw):
        self.sync.adapters[end].path.write_text(raw)

    def config(self, end):
        return self.sync.adapters[end].read().portable

    def edit(self, end, updates):
        adapter = self.sync.adapters[end]
        adapter.write(adapter.read(), updates)

    def converge(self):
        self.sync.run()
        self.assertFalse(self.sync.run(dry_run=True)["changes"])

    def assert_all(self, expected):
        for end in self.sync.adapters:
            self.assertEqual(self.config(end), expected, end)

    def claude_doc(self):
        return json.loads(self.sync.adapters["claude"].path.read_text())

    def set_claude_project(self, project, disabled):
        doc = self.claude_doc()
        doc.setdefault("projects", {}).setdefault(project, {})["disabledMcpServers"] = disabled
        self.put("claude", json.dumps(doc))




class SyncTests(SyncFixture):
    def test_native_arguments_cover_only_the_registered_user_scope(self):
        from mcp_sync import native_remove_request

        self.assertEqual(native_remove_request('codex', ['mcp', 'remove', 'probe'], {}), 'probe')
        for args in (['probe', '--scope', 'user'], ['-s', 'user', 'probe'], ['probe', '--scope=user']):
            self.assertEqual(native_remove_request('claude', ['mcp', 'remove', *args], {}), 'probe')
        for args in (['probe'], ['probe', '-s', 'project'], ['-s', 'local', 'probe'], ['--help']):
            self.assertIsNone(native_remove_request('claude', ['mcp', 'remove', *args], {}))
        self.assertIsNone(native_remove_request('claude', ['mcp', 'remove', 'probe', '-s', 'user'],
                                                {'CLAUDE_CONFIG_DIR': '/custom'}))
        self.assertIsNone(native_remove_request('codex', ['mcp', 'remove', 'probe'], {'CODEX_HOME': '/custom'}))

    def test_native_remove_keeps_exit_failure_and_requires_source_absence(self):
        from mcp_sync import NativeRemoveFailed

        self.edit('codex', {'probe': server()})
        self.converge()
        before = self.sync.state_path.read_bytes()
        with self.assertRaises(NativeRemoveFailed) as failure:
            self.sync.guarded_remove('probe', 'codex', native=lambda: 7)
        self.assertEqual(failure.exception.returncode, 7)
        self.assertEqual(self.sync.guarded_remove('probe', 'codex', native=lambda: 0), 'conflict')
        self.assertEqual(self.sync.state_path.read_bytes(), before)
        self.assert_all({'probe': server()})

    def test_native_remove_journals_before_rereading_broken_destination(self):
        self.edit('claude', {'probe': server()})
        self.converge()
        codex = self.sync.adapters['codex']
        original = codex.path.read_bytes()

        def native():
            self.edit('claude', {'probe': None})
            codex.path.write_text('[broken')
            return 0

        self.assertEqual(self.sync.guarded_remove('probe', 'claude', native=native), 'pending')
        self.assertIsNone(self.sync.load()['pending']['probe']['target'])
        codex.path.write_bytes(original)
        self.converge()
        self.assert_all({})

    def test_native_remove_blocks_preexisting_conflict_and_unreadable_config(self):
        self.edit('codex', {'probe': server()})
        self.converge()
        native = Mock(return_value=0)
        self.edit('claude', {'probe': server(8200)})
        self.assertEqual(self.sync.guarded_remove('probe', 'codex', native=native), 'conflict')
        self.put('claude', '{broken')
        self.assertEqual(self.sync.guarded_remove('probe', 'codex', native=native), 'unavailable')
        native.assert_not_called()
        self.assertNotIn('probe', self.sync.load()['pending'])

    def test_profile_removal_checks_the_registered_file_and_revision(self):
        self.edit('deepseek', {'probe': server()})
        self.converge()
        path = self.sync.adapters['deepseek'].path
        revision = sha256(path.read_bytes()).hexdigest()
        self.assertEqual(self.sync.guarded_remove('probe', 'deepseek', patch_path=path.parent / 'other.yml',
                                                  revision=revision), 'conflict')
        path.write_bytes(path.read_bytes() + b'# edited\n')
        self.assertEqual(self.sync.guarded_remove('probe', 'deepseek', patch_path=path, revision=revision), 'conflict')
        self.assert_all({'probe': server()})
        revision = sha256(path.read_bytes()).hexdigest()
        self.assertEqual(self.sync.guarded_remove('probe', 'deepseek', patch_path=path, revision=revision), 'removed')
        self.assert_all({})

    def test_profile_edit_after_journaling_blocks_all_writes(self):
        self.edit('deepseek', {'probe': server()})
        self.converge()
        path = self.sync.adapters['deepseek'].path
        revision = sha256(path.read_bytes()).hexdigest()
        save = self.sync.save

        def changed_after_save(state):
            save(state)
            path.write_bytes(path.read_bytes() + b'# newer profile\n')

        with patch.object(self.sync, 'save', side_effect=changed_after_save):
            self.assertEqual(self.sync.guarded_remove('probe', 'deepseek', patch_path=path,
                                                      revision=revision), 'conflict')
        self.assert_all({'probe': server()})
        self.assertIn('probe', self.sync.run()['conflicts'])

    def test_failed_profile_write_leaves_other_copies_for_retry(self):
        self.edit('deepseek', {'probe': server()})
        self.converge()
        deepseek = self.sync.adapters['deepseek']
        revision = sha256(deepseek.path.read_bytes()).hexdigest()
        with patch.object(deepseek, 'write', side_effect=OSError):
            self.assertEqual(self.sync.guarded_remove('probe', 'deepseek', patch_path=deepseek.path,
                                                      revision=revision), 'pending')
        self.assert_all({'probe': server()})
        self.converge()
        self.assert_all({})

    def test_three_way_recovers_missing_and_removes_explicitly(self):
        for end, name in [("codex", "one"), ("claude", "two"), ("deepseek", "three")]:
            self.edit(end, {name: server()})
        self.converge()
        self.assert_all({n: server() for n in ("one", "two", "three")})
        self.edit("deepseek", {"one": server(8101)})
        self.edit("codex", {"two": server(8102)})
        self.edit("claude", {"three": None})
        self.converge()
        self.assert_all({"one": server(8101), "two": server(8102), "three": server()})
        self.sync.run(remove="three")
        self.assert_all({"one": server(8101), "two": server(8102)})
        self.assertIn('# comment', self.sync.adapters['codex'].path.read_text())
        self.assertIn('!!js sample', self.sync.adapters['deepseek'].path.read_text())
        self.assertIn('local', json.loads(self.sync.adapters['claude'].path.read_text())['projects']['/a']['mcpServers'])

    def test_repairs_rewritten_configs_from_each_end_and_all_ends(self):
        self.edit("codex", {"probe": server()})
        self.converge()
        rewrites = {
            "codex": 'model = "switched-model"\n',
            "claude": '{"projects":{"/a":{"mcpServers":{"local":{}}}},"account":"switched"}\n',
            "deepseek": '- id: unrelated\n  config:\n    model: switched-model\n',
        }
        for end, raw in rewrites.items():
            self.put(end, raw)
            self.converge()
            self.assert_all({"probe": server()})
        for end, raw in rewrites.items():
            self.put(end, raw)
        self.converge()
        self.assert_all({"probe": server()})
        for end in rewrites:
            self.assertIn('switched', self.sync.adapters[end].path.read_text())
        self.assertIn('local', self.claude_doc()['projects']['/a']['mcpServers'])

    def test_recovers_native_timeouts_and_reloads_codex_after_repair(self):
        self.put("codex", '[mcp_servers.probe]\nurl = "http://127.0.0.1:8100/mcp"\nstartup_timeout_sec = 45\n')
        self.sync.refresh_codex = Mock(return_value="reloaded")
        self.converge()
        self.put("codex", 'model = "switched"\n')
        self.converge()
        self.assertIn('startup_timeout_sec = 45', self.sync.adapters['codex'].path.read_text())
        self.assertEqual(self.sync.refresh_codex.call_count, 2)

    def test_explicit_removal_retries_and_holds_reappearing_entry(self):
        self.edit("codex", {"probe": server()})
        self.converge()
        dsh = self.sync.adapters["deepseek"]
        with patch.object(dsh, "write", side_effect=OSError):
            self.assertIn("probe", self.sync.run(remove="probe")["pending"])
        self.sync = Sync(self.home, self.home / "state")
        self.converge()
        self.assert_all({})
        self.edit("claude", {"probe": server(8101)})
        report = self.sync.run()
        self.assertEqual(report["reappeared"], {"probe": ["claude"]})
        self.assertEqual(self.config("codex"), {})
        with self.assertRaises(SyncError):
            self.sync.run(resolve=("probe", "codex"))
        self.sync.run(resolve=("probe", "claude"))
        self.assert_all({"probe": server(8101)})

    def test_legacy_pending_deletion_is_preserved_as_conflict(self):
        self.edit("deepseek", {"probe": server()})
        self.sync.save({"version": 2, "base": {"probe": server()}, "pending": {
            "probe": {"before": {"codex": server(), "claude": None, "deepseek": server()}, "target": None},
        }})
        before = {end: adapter.path.read_bytes() for end, adapter in self.sync.adapters.items()}
        self.assertIn("probe", self.sync.run()["conflicts"])
        self.assertEqual({end: adapter.path.read_bytes() for end, adapter in self.sync.adapters.items()}, before)
        self.assertIn("probe", self.sync.load()["pending"])
        self.sync.run(resolve=("probe", "deepseek"))
        self.assert_all({"probe": server()})

    def test_remove_journals_intent_if_a_rewrite_restores_an_absent_entry(self):
        self.edit("codex", {"probe": server()})
        self.converge()
        for end in self.sync.adapters:
            self.edit(end, {"probe": None})
        codex = self.sync.adapters["codex"]
        before = codex.read()
        restored = codex.render(before, {"probe": server()})
        first_read = [before]

        def reread():
            if first_read:
                return first_read.pop()
            self.put("codex", restored.decode())
            return codex.decode(restored)

        with patch.object(codex, "read", side_effect=reread):
            self.assertIn("probe", self.sync.run(remove="probe")["pending"])
        self.converge()
        self.assert_all({})


    def test_claude_toggle_excludes_project_mcp_with_same_name(self):
        self.edit("codex", {"probe": server()})
        doc = self.claude_doc()
        doc["projects"]["/a"]["mcpServers"]["probe"] = {"type": "stdio", "command": "/bin/cat"}
        doc["projects"]["/a"]["disabledMcpServers"] = ["probe"]
        self.put("claude", json.dumps(doc))
        self.converge()
        self.assert_all({"probe": server()})
        self.assertEqual(self.claude_doc()["projects"]["/a"]["disabledMcpServers"], ["probe"])



    def test_runtime_reload_retries_and_runs_on_changes_from_any_source(self):
        refresh = Mock(side_effect=[SyncError("offline"), "reloaded", "reloaded"])
        self.sync.refresh_codex = refresh
        self.edit("deepseek", {"probe": server()})
        self.assertIn("codex_runtime", self.sync.run()["errors"])
        self.assertEqual(self.sync.run()["codex_runtime"], "reloaded")
        self.sync.run()
        self.assertEqual(refresh.call_count, 2)
        self.edit("codex", {"probe": server(8103)})
        self.converge()
        self.assertEqual(refresh.call_count, 3)

    def test_conflict_and_resolution(self):
        self.edit("codex", {"probe": server(8100)})
        self.edit("deepseek", {"probe": server(8101)})
        self.edit("claude", {"unrelated": server(8102)})
        report = self.sync.run()
        self.assertIn("probe", report["conflicts"])
        self.assertNotIn("probe", self.config("claude"))
        self.assertIn("unrelated", self.config("codex"))
        self.sync.run(resolve=("probe", "deepseek"))
        self.converge()
        self.assert_all({"probe": server(8101), "unrelated": server(8102)})
        self.edit("codex", {"probe": None})
        self.edit("claude", {"probe": server(8103)})
        self.edit("deepseek", {"probe": server(8104)})
        self.assertIn("probe", self.sync.run()["conflicts"])
        self.assertNotIn("probe", self.config("codex"))

    def test_malformed_source_and_unsupported(self):
        self.edit("codex", {"probe": server()})
        self.converge()
        self.put("claude", "{broken")
        with self.assertRaises(SyncError):
            self.sync.run()
        self.assertIn("probe", self.config("codex"))
        self.put("claude", '{"mcpServers":{"probe":{"type":"http","url":"http://localhost/mcp","headers":{"Authorization":"secret"}}}}')
        report = self.sync.run()
        self.assertIn("probe", report["skipped"])
        self.assertNotIn("secret", json.dumps(report))
        self.assertIn("probe", self.config("deepseek"))

    def test_partial_failure_and_concurrent_change(self):
        self.edit("codex", {"probe": server()})
        dsh = self.sync.adapters["deepseek"]
        with patch.object(dsh, "write", side_effect=OSError("private detail")):
            result = self.sync.run()
        self.assertIn("probe", result["pending"])
        self.assertIn("probe", self.config("claude"))
        self.assertNotIn("probe", self.config("deepseek"))
        self.converge()
        self.assert_all({"probe": server()})
        snapshot = dsh.read()
        self.put("deepseek", dsh.path.read_text() + "# concurrent edit\n")
        with self.assertRaises(SyncError):
            dsh.write(snapshot, {"probe": None})
        self.assertIn("probe", self.config("deepseek"))

    def test_dry_run_and_native_lock(self):
        self.edit("codex", {"probe": server()})
        self.assertIn("probe", self.sync.run(dry_run=True)["changes"])
        self.assertFalse(self.sync.state_path.exists())
        self.assertEqual(self.config("claude"), {})
        lock = self.sync.adapters["deepseek"].path.parent / "package.json.lock"
        lock.write_text("1\n")
        self.assertIn("probe", self.sync.run()["pending"])
        self.assertEqual(lock.read_text(), "1\n")
        lock.unlink()
        self.converge()

    def test_native_settings_and_auth_boundaries(self):
        self.put("codex", '[mcp_servers.node_repl]\ncommand = "/bin/cat"\n'
                 '[mcp_servers.keep]\ncommand = "/bin/cat"\nstartup_timeout_sec = 42\n'
                 '[mcp_servers.sensitive]\nurl = "https://example.test/mcp"\n'
                 'bearer_token_env_var = "MCP_TOKEN"\n')
        self.converge()
        self.assertEqual(set(self.config("claude")), {"keep"})
        self.edit("deepseek", {"keep": {"type":"stdio","command":"/bin/echo",}})
        self.converge()
        native = self.sync.adapters["codex"].path.read_text()
        self.assertIn("startup_timeout_sec = 42", native)
        self.assertIn("node_repl", native)
        self.assertIn("MCP_TOKEN", native)

    def test_native_deepseek_insert_keep_name_and_other_rows(self):
        self.put("deepseek", """# profile comment
- insert:
    - id: unrelated-plugin
      name: other-plugin
      config:
        key: !!js sample
    - id: custom-cordis-id
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: shared_original-name
        transport: streamable-http
        url: http://127.0.0.1:8100/mcp
        startupTimeoutMs: 45000
""")
        self.converge()
        self.assert_all({"shared_original-name": server()})
        self.edit("codex", {"shared_original-name": server(8101)})
        self.converge()
        adapter = self.sync.adapters["deepseek"]
        doc = adapter.parse(adapter.read().raw)
        row = doc[0]["insert"][1]
        self.assertEqual(row["id"], "custom-cordis-id")
        self.assertEqual(row["config"]["serverName"], "shared_original-name")
        self.assertEqual(row["config"]["startupTimeoutMs"], 45000)
        self.assertNotIn("disabled", row)
        self.assertIn("shared_original-name", self.config("claude"))
        self.edit("codex", {"shared_original-name": server(8101)})
        self.converge()
        self.assert_all({"shared_original-name": server(8101)})
        self.edit("claude", {"shared_original-name": None})
        self.sync.run(remove="shared_original-name")
        self.converge()
        self.assert_all({})
        self.assertIn("# profile comment", adapter.read().raw.decode())
        self.assertIn("!!js sample", adapter.read().raw.decode())
        self.assertEqual(len(adapter.parse(adapter.read().raw)[0]["insert"]), 1)

    def test_deepseek_duplicate_and_conditional_entries_stay_local(self):
        self.put("deepseek", """- insert:
    - id: first
      name: '@deepseek-ai/dsh-mcp-client'
      config: {serverName: duplicate, transport: stdio, command: /bin/cat}
    - id: second
      name: '@deepseek-ai/dsh-mcp-client'
      config: {serverName: duplicate, transport: stdio, command: /bin/cat}
    - id: conditional
      name: '@deepseek-ai/dsh-mcp-client'
      disabled: !!js "true"
      config: {serverName: conditional, transport: stdio, command: /bin/cat}
    - id: mcp-sync-good
      name: unrelated
""")
        self.edit("codex", {"good": server()})
        report = self.sync.run()
        self.assertEqual(set(report["skipped"]), {"duplicate", "conditional"})
        self.assertEqual(self.config("claude"), {"good": server()})
        adapter = self.sync.adapters["deepseek"]
        added = adapter.parse(adapter.read().raw)[1]["insert"][0]
        self.assertNotEqual(added["id"], "mcp-sync-good")
        self.assertEqual(added["config"]["serverName"], "good")

    def test_deepseek_override_is_not_an_implicit_delete(self):
        self.edit("codex", {"probe": server()})
        self.converge()
        adapter = self.sync.adapters["deepseek"]
        self.put("deepseek", adapter.path.read_text() + '\n- id: mcp-sync-probe\n  disabled: true\n')
        self.assertIn("probe", self.sync.run()["skipped"])
        self.assertIn("probe", self.config("codex"))

if __name__ == "__main__":
    unittest.main()
