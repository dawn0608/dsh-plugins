import { basename, dirname, isAbsolute, join } from 'node:path';
import { isSkillName } from './host-bundle.js';
import { regularFile } from './shared-sync.js';

const MAX_ICON_BYTES = 64 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SVG_ROOT = /^\s*(?:(?:<\?xml\b[\s\S]*?\?>|<!--[\s\S]*?-->)\s*)*<svg(?=[\s/>])/u;

async function readIcon(base) {
  for (const [extension, type] of [['svg', 'svg+xml'], ['png', 'png']]) {
    const bytes = await regularFile(base + '.' + extension, MAX_ICON_BYTES).catch(() => null);
    if (!bytes) continue;
    const valid = extension === 'svg'
      ? SVG_ROOT.test(bytes.toString('utf8'))
      : bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
    if (valid) return 'data:image/' + type + ';base64,' + bytes.toString('base64');
  }
  return undefined;
}

export async function skillIcon(overrideDirectory, name, skillFile) {
  if (!isSkillName(name)) return undefined;
  const override = await readIcon(join(overrideDirectory, name));
  if (override) return override;
  if (typeof skillFile === 'string' && isAbsolute(skillFile) && basename(skillFile) === 'SKILL.md') {
    return readIcon(join(dirname(skillFile), 'icon'));
  }
  return undefined;
}
