// Copy vendored skill MDs from src/templates/skills/ → dist/templates/skills/
// after `tsc` runs. tsc only emits .js — without this, production builds
// would crash at bootstrap because vendoredSkillFiles() can't find them.
//
// Dev mode (tsx watch) doesn't need this; tsx reads from src/ directly.

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, '..', 'src', 'templates', 'skills');
const dstDir = path.resolve(here, '..', 'dist', 'templates', 'skills');

if (!existsSync(srcDir)) {
  console.error('[copy-skills] no src/templates/skills/ — nothing to copy');
  process.exit(0);
}

mkdirSync(path.dirname(dstDir), { recursive: true });
cpSync(srcDir, dstDir, { recursive: true, filter: (src) => /\.md$|\/$/.test(src) || !path.extname(src) });
console.log(`[copy-skills] copied ${srcDir} → ${dstDir}`);
