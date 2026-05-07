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
// Copy .md (rules) and .yaml (invocation defaults) but skip .py (codex
// runs scripts from its own ~/.codex/skills/, not from our copy) and
// __pycache__. Directories must pass through so cpSync can recurse.
cpSync(srcDir, dstDir, {
  recursive: true,
  filter: (src) => {
    if (src.includes('__pycache__')) return false;
    const ext = path.extname(src);
    if (!ext) return true; // directory
    return ext === '.md' || ext === '.yaml';
  },
});
console.log(`[copy-skills] copied ${srcDir} → ${dstDir}`);
