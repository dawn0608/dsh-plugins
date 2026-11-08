# Skills

Open **Skills** below **Plugins** in the DeepSeek Harness sidebar. Search the global catalog by name or description. Select a skill to see its full description, source, and `SKILL.md` preview.

The list groups skills as Built-in, Self-authored, and Third-party. Harness identifies built-in skills. For shared skills, record provenance in `~/.agents/skills/.provenance.json` (or under `$DSH_AGENTS_HOME/skills`). Use the instruction file path relative to the skills root as the key, such as `my-skill/SKILL.md`, and set `origin` to `self` or `third-party`. For third-party skills, an optional credential-free HTTPS `repository` URL appears in the details. Unrecorded skills appear under Third-party with their origin marked unconfirmed in the details.

Previously imported skills can be switched on or off from the list and uninstalled from their details. The plugin stores its copies in `$DSH_HOME/skill-manager/bundles` and activates them in `$DSH_HOME/skills` for Harness profiles using that home.

## Install

Build from the repository root:

```bash
npm ci
npm run build --workspace @dawn0608/dsh-skill-manager
```

In Harness Desktop, open **Plugins → Add plugin** and enter the absolute path of the `plugins/skill-manager` directory. Follow the restart prompt if one appears.

Use Harness Desktop `0.2.2-rc.1` or a compatible version below `0.3.0`.
