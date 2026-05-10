// Scaffolds for new OGF projects. Each creates a minimal but runnable
// skeleton that follows the conventions doc. Codex's first turn fills
// in the gameplay; OGF's editor stays useful from minute one.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EngineKind } from '@ogf/contracts';
import { godotConventions, webConventions } from './conventions.js';

// Skills are vendored under templates/skills/. We copy them into every
// new project's `.agents/skills/` folder — the canonical OpenAI Codex
// path (codex auto-discovers skills walking up from CWD to repo root).
// See https://developers.openai.com/codex/skills .
//
// This makes OGF a SELF-CONTAINED PRODUCT: clone the repo, scaffold a
// project, codex finds skills automatically. No `~/.codex/skills/`
// install required, no `--skill-dir` flag needed. Closer-to-CWD wins
// codex's resolution order, so the bundled skills override anything
// the user has installed globally — guarantees reproducibility.
//
// Bundle EVERYTHING this time: .md (rules), .yaml (invocation
// defaults), AND .py (scripts codex spawns at skill invocation).
// Previous bundle skipped .py because we (incorrectly) assumed codex
// always runs scripts from ~/.codex/skills/. Path-5 discovery means
// codex runs scripts from .agents/skills/ when project-local — so .py
// is now load-bearing, not decorative.
//
// Re-vendor: copy from ~/.codex/skills/ → templates/skills/ when
// upstream skills have changes worth picking up.
const SKILLS_SRC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'skills',
);

/** Walk the vendored skills tree and produce ScaffoldFile entries
 *  rooted at `.agents/skills/`. Recursive so SKILL.md + references/* +
 *  scripts/*.py + agents/*.yaml all land at the right shape under
 *  the project. */
function vendoredSkillFiles(): ScaffoldFile[] {
  if (!existsSync(SKILLS_SRC_DIR)) return [];
  const out: ScaffoldFile[] = [];
  const walk = (absDir: string, relSegments: string[]): void => {
    for (const entry of readdirSync(absDir)) {
      const absChild = path.join(absDir, entry);
      const stat = statSync(absChild);
      if (stat.isDirectory()) {
        // Skip __pycache__ — compile cache, never useful in a project.
        if (entry === '__pycache__') continue;
        walk(absChild, [...relSegments, entry]);
        continue;
      }
      // Bundle:
      //   .md   — SKILL.md, references/*.md (rules the agent reads)
      //   .yaml — agents/openai.yaml (distilled invocation prompts)
      //   .py   — scripts/* (codex runs these at invocation time)
      if (!/\.(md|yaml|py)$/.test(entry)) continue;
      const projectRel = ['.agents', 'skills', ...relSegments, entry].join('/');
      out.push({ rel: projectRel, body: readFileSync(absChild, 'utf8') });
    }
  };
  walk(SKILLS_SRC_DIR, []);
  return out;
}

// ── Vendored convention files ─────────────────────────────────────
//
// We split the old monolithic conventions.ts (~1700 lines) into
// genre-aware .md files. Bootstrap copies ALL of them into every
// project — agent reads only `common.md` + `runtime-patterns.md` +
// the genre file matching the project's chosen genre. Cross-genre
// pollution avoided; long sessions don't waste context on rules
// for the wrong genre.
const CONVENTIONS_SRC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'conventions',
);

/** Walk vendored conventions/ tree and produce ScaffoldFile entries
 *  rooted at `.ogf/conventions/`. */
function vendoredConventionFiles(): ScaffoldFile[] {
  if (!existsSync(CONVENTIONS_SRC_DIR)) return [];
  const out: ScaffoldFile[] = [];
  const walk = (absDir: string, relSegments: string[]): void => {
    for (const entry of readdirSync(absDir)) {
      const absChild = path.join(absDir, entry);
      const stat = statSync(absChild);
      if (stat.isDirectory()) {
        walk(absChild, [...relSegments, entry]);
        continue;
      }
      if (!entry.endsWith('.md')) continue;
      const projectRel = ['.ogf', 'conventions', ...relSegments, entry].join('/');
      out.push({ rel: projectRel, body: readFileSync(absChild, 'utf8') });
    }
  };
  walk(CONVENTIONS_SRC_DIR, []);
  return out;
}

// ── Vendored foundation seeds (per-genre starter scaffolds) ────────────
//
// Foundation seed = the richer scaffolding extracted from a known-good
// reference project. Each genre that has a hand-built reference gets its
// own seed under foundation/<genre>/seed/. Currently shipped:
//   foundation/top-down-rpg/seed/   (Sengoku-Era-ogf-derived, 36 files)
//
// At project create time we DO NOT copy these to the project root —
// the genre is unknown until the spec is approved. Instead we stage
// every available seed under .ogf/foundation-seeds/<genre>/seed/. The
// agent picks its own genre's seed during Phase 0 (see
// conventions/common.md) and either copies it to root verbatim or, when
// no seed exists for the chosen genre, builds the file structure from
// scratch using the module-architecture rules in the conventions.
const FOUNDATION_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'foundation',
);

/** Walk every foundation/<genre>/seed/ tree and produce ScaffoldFile
 *  entries rooted at .ogf/foundation-seeds/<genre>/seed/ — preserving
 *  the inner src/ and data/ subfolders. Skips the legacy flat layout
 *  (foundation/seed/) if it still exists from an in-progress migration. */
function vendoredFoundationSeedFiles(): ScaffoldFile[] {
  if (!existsSync(FOUNDATION_DIR)) return [];
  const out: ScaffoldFile[] = [];
  for (const genre of readdirSync(FOUNDATION_DIR)) {
    const genreDir = path.join(FOUNDATION_DIR, genre);
    if (!statSync(genreDir).isDirectory()) continue;
    const seedDir = path.join(genreDir, 'seed');
    if (!existsSync(seedDir) || !statSync(seedDir).isDirectory()) continue;
    const walk = (absDir: string, relSegments: string[]): void => {
      for (const entry of readdirSync(absDir)) {
        const absChild = path.join(absDir, entry);
        const stat = statSync(absChild);
        if (stat.isDirectory()) {
          walk(absChild, [...relSegments, entry]);
          continue;
        }
        const projectRel = [
          '.ogf',
          'foundation-seeds',
          genre,
          'seed',
          ...relSegments,
          entry,
        ].join('/');
        out.push({ rel: projectRel, body: readFileSync(absChild, 'utf8') });
      }
    };
    walk(seedDir, []);
  }
  return out;
}

// ── Vendored recipes (per-genre paste-ready code patterns) ─────────────
//
// Recipes are markdown files with paste-ready code snippets and "when
// to use / when NOT to use" guidance. Agent reads them at phase-execute
// time to decide whether/how to apply each pattern. Land in
// .ogf/recipes/{universal,top-down-rpg,...}/ so agent can find them
// alongside conventions.
const RECIPES_SRC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'recipes',
);

function vendoredRecipeFiles(): ScaffoldFile[] {
  if (!existsSync(RECIPES_SRC_DIR)) return [];
  const out: ScaffoldFile[] = [];
  const walk = (absDir: string, relSegments: string[]): void => {
    for (const entry of readdirSync(absDir)) {
      const absChild = path.join(absDir, entry);
      const stat = statSync(absChild);
      if (stat.isDirectory()) {
        walk(absChild, [...relSegments, entry]);
        continue;
      }
      if (!entry.endsWith('.md')) continue;
      const projectRel = ['.ogf', 'recipes', ...relSegments, entry].join('/');
      out.push({ rel: projectRel, body: readFileSync(absChild, 'utf8') });
    }
  };
  walk(RECIPES_SRC_DIR, []);
  return out;
}

interface ScaffoldFile {
  rel: string;
  body: string;
}

interface BootstrapResult {
  files: string[];
}

function writeIfMissing(rootAbs: string, files: ScaffoldFile[]): string[] {
  const written: string[] = [];
  for (const f of files) {
    const abs = path.join(rootAbs, f.rel);
    if (existsSync(abs)) continue;
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, f.body, 'utf8');
    written.push(f.rel);
  }
  return written;
}

// ---------- Godot ----------

const GODOT_PROJECT = (name: string) => `; Auto-generated by Open Game Forge.
; Edit through the Project Settings dialog or here directly.

config_version=5

[application]

config/name="${name}"
run/main_scene="res://scenes/Main.tscn"
config/features=PackedStringArray("4.5")

[display]

window/size/viewport_width=1280
window/size/viewport_height=720
window/stretch/mode="canvas_items"

[rendering]

renderer/rendering_method="gl_compatibility"

[debug]

; Codex-generated GDScript leans heavily on Dictionary / JSON access.
; Treating Variant inference / untyped declarations as ERROR makes the
; project unloadable after almost every iteration. Keep them as warnings.
gdscript/warnings/treat_warnings_as_errors=false
gdscript/warnings/inferred_declaration=1
gdscript/warnings/untyped_declaration=1
gdscript/warnings/unsafe_property_access=0
gdscript/warnings/unsafe_method_access=0
`;

const GODOT_MAIN_TSCN = `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/Main.gd" id="1"]

[node name="Main" type="Node2D"]
script = ExtResource("1")
`;

const GODOT_MAIN_GD = `extends Node2D

# Auto-generated entry point. Replace with your game's logic.
# Convention: load gameplay data from data/*.json (see .ogf/conventions.md).

func _ready() -> void:
\tprint("OGF project — Main.tscn loaded")

func _load_json(path: String) -> Variant:
\tvar text := FileAccess.get_file_as_string(path)
\treturn JSON.parse_string(text)
`;

const GODOT_GITIGNORE = `# Godot
.godot/
*.tmp
*.import.bak

# OGF
.ogf/
`;

function godotFiles(name: string, conventions: string): ScaffoldFile[] {
  return [
    { rel: 'project.godot', body: GODOT_PROJECT(name) },
    { rel: 'scenes/Main.tscn', body: GODOT_MAIN_TSCN },
    { rel: 'scripts/Main.gd', body: GODOT_MAIN_GD },
    { rel: '.gitignore', body: GODOT_GITIGNORE },
    // .ogf/conventions.md kept as a thin index that points the agent at
    // the new genre-aware structure under .ogf/conventions/. The big
    // monolithic conventions.ts was split into common.md + runtime-
    // patterns.md + genres/<name>.md so each project loads only what's
    // relevant to its genre. The `conventions` string passed in is now
    // a short pointer/legacy shim, NOT the authoritative content.
    { rel: '.ogf/conventions.md', body: conventions },
    ...vendoredConventionFiles(),
    ...vendoredRecipeFiles(),
    ...vendoredSkillFiles(),
    { rel: 'data/.gitkeep', body: '' },
    { rel: 'assets/.gitkeep', body: '' },
  ];
}

// ---------- Web ----------

const WEB_INDEX = (name: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${name}</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main>
      <canvas id="game" width="1280" height="720"></canvas>
    </main>
    <script type="module" src="src/game.js"></script>
  </body>
</html>
`;

const WEB_STYLES = `* { box-sizing: border-box; }
body {
  margin: 0;
  background: #111;
  color: #ddd;
  font-family: system-ui, sans-serif;
  display: grid;
  place-items: center;
  min-height: 100vh;
}
canvas {
  display: block;
  background: #000;
  image-rendering: pixelated;
  max-width: 100%;
  height: auto;
}
`;

// ---- Modular game scaffold ----
// game.js stays small — it boots the system and runs the frame loop. Real work
// lives in scene.js (data loading + draw dispatch), render.js (camera + draw
// primitives), and input.js (keyboard). This split is what conventions.md
// codifies: every module has one job and a typical size of 50–200 lines, so
// OGF can reason about each independently.

const WEB_GAME_JS = `// Entry point. Boots the renderer + scene + input, then runs the frame loop.
// See .ogf/conventions.md for why this file is small (and what each module does).

import { initRenderer, errorScreen } from './render.js';
import { loadLevels, switchScene, drawCurrent } from './scene.js';
import { initInput } from './input.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

async function start() {
  initRenderer(canvas, ctx);
  initInput(canvas);

  const levels = await loadLevels();
  const first = levels.levels?.[0]?.id ?? 'level1';
  await switchScene(first);

  function frame(now) {
    drawCurrent(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

start().catch((err) => {
  console.error(err);
  errorScreen('start() failed: ' + (err?.message ?? err));
});
`;

const WEB_SCENE_JS = `// Scene loader and draw dispatcher. Reads level JSON from data/, pre-loads
// every referenced sprite, hands the rendered scene to render.js. Add new
// state per-scene (entities, timers) as your game grows; keep IO + data
// shaping here.

import { loadJSON, loadImage } from './assets.js';
import { fitCanvas, drawBackground, drawProps } from './render.js';

let levelsManifest = null;
const cache = {};      // { sceneId: levelData }
const images = {};     // { 'assets/.../x.png': HTMLImageElement }
let current = null;
let bg = null;

export async function loadLevels() {
  levelsManifest = await loadJSON('data/levels.json');
  return levelsManifest;
}

export async function switchScene(id) {
  const entry = levelsManifest?.levels?.find((l) => l.id === id);
  if (!entry) throw new Error('unknown scene id: ' + id);
  if (!cache[id]) cache[id] = await loadJSON(entry.file);
  current = cache[id];

  fitCanvas(current);

  // Pre-load this scene's background + every prop sprite.
  bg = current.background ? await safeImage(current.background) : null;
  await Promise.all(
    (current.props ?? []).map(async (p) => {
      if (p.image && !images[p.image]) images[p.image] = await safeImage(p.image);
    }),
  );
}

async function safeImage(src) {
  try { return await loadImage(src); } catch (e) { console.warn(e); return null; }
}

export function getCurrentScene() { return current; }
export function getImage(src) { return images[src]; }

export function drawCurrent(_now) {
  if (!current) return;
  drawBackground(bg);
  drawProps(current.props ?? [], (src) => images[src]);
}
`;

const WEB_RENDER_JS = `// Renderer + camera. World coords ↔ screen coords go through sx/sy. All
// drawing primitives live here; scene/entity modules call them with raw
// world-space numbers. (Initial setup: 1:1, no camera transform.)

let canvas = null;
let ctx = null;
const camera = { x: 0, y: 0, scale: 1 };

export function initRenderer(c, x) { canvas = c; ctx = x; }

export function fitCanvas(level) {
  const m = level.mapSize ?? { width: 1280, height: 720 };
  if (canvas.width !== m.width) canvas.width = m.width;
  if (canvas.height !== m.height) canvas.height = m.height;
}

export function setCamera(x, y, scale = 1) { camera.x = x; camera.y = y; camera.scale = scale; }
export function sx(x) { return (x - camera.x) * camera.scale; }
export function sy(y) { return (y - camera.y) * camera.scale; }

export function drawBackground(image) {
  if (image) {
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

/** props: array of { id, image, x, y, w, h, sortY? } — bottom-center anchor. */
export function drawProps(props, lookup) {
  const sorted = props.slice().sort((a, b) => (a.sortY ?? a.y) - (b.sortY ?? b.y));
  for (const p of sorted) {
    const img = lookup(p.image);
    if (!img) continue;
    ctx.drawImage(img, sx(p.x) - p.w / 2, sy(p.y) - p.h, p.w * camera.scale, p.h * camera.scale);
  }
  if (props.length === 0) {
    ctx.fillStyle = '#888';
    ctx.font = '20px system-ui';
    ctx.fillText("Empty level. Add props in OGF's Scenes tab,", 40, 60);
    ctx.fillText('or ask Codex to generate a background + props.', 40, 90);
  }
}

export function errorScreen(message) {
  if (!ctx) return;
  ctx.fillStyle = '#400';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fcc';
  ctx.font = '16px system-ui';
  ctx.fillText(message, 20, 30);
}
`;

const WEB_INPUT_JS = `// Keyboard + mouse. Translates raw events into a small intent surface that
// scene/entity modules can poll without coupling to the DOM.

const keys = new Set();
const mouse = { x: 0, y: 0, down: false };

export function initInput(canvas) {
  window.addEventListener('keydown', (e) => keys.add(e.code));
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) * (canvas.width / r.width);
    mouse.y = (e.clientY - r.top) * (canvas.height / r.height);
  });
  canvas.addEventListener('mousedown', () => { mouse.down = true; });
  canvas.addEventListener('mouseup', () => { mouse.down = false; });
}

export function isDown(code) { return keys.has(code); }
export function getMouse() { return { x: mouse.x, y: mouse.y, down: mouse.down }; }
`;

const WEB_ASSETS_JS = `// Tiny IO helpers shared by every module. No game state lives here.

export async function loadJSON(rel) {
  const r = await fetch(rel);
  if (!r.ok) throw new Error('fetch ' + rel + ': ' + r.status);
  return await r.json();
}

export function loadImage(rel) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not load ' + rel));
    img.src = rel;
  });
}
`;

const WEB_LEVELS_JSON = `{
  "levels": [
    { "id": "level1", "file": "data/level1.json" }
  ]
}
`;

const WEB_LEVEL1_JSON = `{
  "id": "level1",
  "background": "assets/maps/level1.png",
  "mapSize": { "width": 1280, "height": 720 },
  "spawn": { "x": 640, "y": 600 },
  "exits": {},
  "zones": {},
  "walkBounds": [],
  "blockers": [],
  "spawn_points": [],
  "props": []
}
`;

const WEB_GITIGNORE = `# OGF
.ogf/

# Editor / OS
.DS_Store
node_modules/
`;

function webFiles(name: string, conventions: string): ScaffoldFile[] {
  // OGF v2: project root always gets the minimal inline scaffold (5
  // tiny files) so dev mode runs immediately. The full per-genre seeds
  // are staged under .ogf/foundation-seeds/<genre>/seed/ and the agent
  // copies the matching one to root during Phase 0 (see
  // conventions/common.md). For genres without a seed, the agent builds
  // the file structure from scratch using the module-architecture rules
  // and the inline stubs as a runnable starting point.
  return [
    { rel: 'index.html', body: WEB_INDEX(name) },
    { rel: 'styles.css', body: WEB_STYLES },
    { rel: 'src/game.js', body: WEB_GAME_JS },
    { rel: 'src/scene.js', body: WEB_SCENE_JS },
    { rel: 'src/render.js', body: WEB_RENDER_JS },
    { rel: 'src/input.js', body: WEB_INPUT_JS },
    { rel: 'src/assets.js', body: WEB_ASSETS_JS },
    { rel: 'data/levels.json', body: WEB_LEVELS_JSON },
    { rel: 'data/level1.json', body: WEB_LEVEL1_JSON },
    { rel: '.gitignore', body: WEB_GITIGNORE },
    { rel: '.ogf/conventions.md', body: conventions },
    ...vendoredConventionFiles(),
    ...vendoredRecipeFiles(),
    ...vendoredSkillFiles(),
    ...vendoredFoundationSeedFiles(), // staged under .ogf/foundation-seeds/
    { rel: 'assets/maps/.gitkeep', body: '' },
    { rel: 'assets/sprites/.gitkeep', body: '' },
  ];
}

// ---------- Entry ----------

export function bootstrapProject(opts: {
  rootAbs: string;
  engine: EngineKind;
  name: string;
}): BootstrapResult {
  mkdirSync(opts.rootAbs, { recursive: true });
  let files: ScaffoldFile[];
  if (opts.engine === 'godot') {
    files = godotFiles(opts.name, godotConventions());
  } else if (opts.engine === 'web') {
    files = webFiles(opts.name, webConventions());
  } else {
    throw new Error(`Bootstrap not yet supported for engine: ${opts.engine}`);
  }
  const written = writeIfMissing(opts.rootAbs, files);
  return { files: written };
}
