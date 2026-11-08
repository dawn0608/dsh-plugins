# Skills

Open **Skills** below **Plugins** in the DeepSeek Harness sidebar. Search by name or description, choose a workspace to include its skills, and open a row to preview the instructions. The page uses the catalog Harness discovers with its default Agent preset for the selected workspace.

Use **Add skill** to select a directory containing `SKILL.md` or a standalone `SKILL.md` file. Review the name and source, then confirm to import and enable it. A directory import includes its resources. Each import supports up to 256 files and 8 MiB of file data.

Imported skills can be switched on or off from the list and uninstalled from their details. The plugin stores its copies in `$DSH_HOME/skill-manager/bundles` and activates them in `$DSH_HOME/skills` for Harness profiles using that home. A workspace can take precedence with its own skill of the same name. Existing project, shared, local, and built-in skills are available for preview.

## Install

Build from the repository root:

```bash
npm ci
npm run build --workspace @dawn0608/dsh-skill-manager
```

In Harness Desktop, open **Plugins → Add plugin** and enter the absolute path of the `plugins/skill-manager` directory. Follow the restart prompt if one appears.

Use Harness Desktop `0.2.2-rc.1` or a compatible version below `0.3.0`.
