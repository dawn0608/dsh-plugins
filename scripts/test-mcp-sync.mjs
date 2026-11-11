import { spawnSync } from 'node:child_process';
import { resolve, delimiter } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const python = process.env.DSH_SYNC_PYTHON || 'python3';
const result = spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'plugins/mcp-manager/test/sync'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1',
    PYTHONPATH: [resolve(root, 'plugins/mcp-manager/src/sync'), process.env.PYTHONPATH].filter(Boolean).join(delimiter) },
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
