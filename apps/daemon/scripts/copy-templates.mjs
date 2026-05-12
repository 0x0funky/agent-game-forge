// Copy vendored template assets from src/templates/{skills,conventions}/ →
// dist/templates/{skills,conventions}/ after `tsc` runs. tsc only emits .js
// — without this, production builds would crash at bootstrap because
// vendoredSkillFiles() / vendoredConventionFiles() can't find them.
//
// Dev mode (tsx watch) doesn't need this; tsx reads from src/ directly.

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function copyTemplateDir(name, allowedExts, options = {}) {
  const srcDir = path.resolve(here, '..', 'src', 'templates', name);
  const dstDir = path.resolve(here, '..', 'dist', 'templates', name);
  if (!existsSync(srcDir)) {
    console.error(`[copy-templates] no src/templates/${name}/ — skip`);
    return;
  }
  mkdirSync(path.dirname(dstDir), { recursive: true });
  cpSync(srcDir, dstDir, {
    recursive: true,
    filter: (src) => {
      if (options.skipDirNames?.some((n) => src.includes(`${path.sep}${n}${path.sep}`))) return false;
      if (options.skipDirNames?.some((n) => src.endsWith(`${path.sep}${n}`))) return false;
      const ext = path.extname(src);
      if (!ext) return true; // directory
      return allowedExts.includes(ext);
    },
  });
  console.log(`[copy-templates] copied ${srcDir} → ${dstDir}`);
}

// Skills: .md (rules), .yaml (codex invocation defaults), .py (scripts
// codex spawns when the skill is invoked from .agents/skills/).
copyTemplateDir('skills', ['.md', '.yaml', '.py'], { skipDirNames: ['__pycache__'] });

// Conventions: only .md. Folder structure (genres/) preserved.
copyTemplateDir('conventions', ['.md']);

// Foundation seed (OGF v2): the Sengoku-Era-ogf-derived starter scaffold.
// Includes index.html / styles.css / src/*.js / data/*.json + SEED.md.
copyTemplateDir('foundation', ['.md', '.html', '.css', '.js', '.json']);

// Recipes (OGF v2): per-genre paste-ready code patterns. Markdown only.
copyTemplateDir('recipes', ['.md']);

// Agent tools (OGF v2 multi-CLI): CLI helpers landed at .agents/tools/.
// gen-image.py POSTs to daemon's /api/gen-image so non-Codex agents
// (Claude Code, future Gemini CLI, bash wrappers) can drive image gen.
copyTemplateDir('agent-tools', ['.py', '.sh', '.md']);
