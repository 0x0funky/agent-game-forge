const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

let MAP = { w: 0, h: 0 };
const VIEW = { w: canvas.width, h: canvas.height };
let CAMERA = { w: 960, h: 540, x: 0, y: 0, scale: VIEW.w / 960 };
let SAVE_KEY = "";
let PREVIOUS_SAVE_KEY = "";
let OLD_SAVE_KEY = "";
let FOOT_RADIUS = 12;
let MAX_LEVEL = 1;
let EVOLUTION_LEVELS = [];
let SKILL_LEVELS = [];

const images = {};
const collisionMaps = {};
let collisionMap = null;

let imagePaths = {};
let animationPaths = {};
let PROGRESSION_CONFIG = {};
let OVERWORLD_CONFIG = {};
let BATTLE_CONFIG = {};
let RUNTIME_CONFIG = {};
let ANIM = {};
let BATTLE_STRINGS = {};

function applyRuntimeConfig(config) {
  RUNTIME_CONFIG = { ...(config ?? {}) };
  const mapSize = config.mapSize ?? {};
  MAP = {
    w: Number(mapSize.width) || 0,
    h: Number(mapSize.height) || 0,
  };

  const camera = config.camera ?? {};
  CAMERA = {
    w: Number(camera.width) || 960,
    h: Number(camera.height) || 540,
    x: 0,
    y: 0,
    scale: VIEW.w / (Number(camera.width) || 960),
  };

  SAVE_KEY = config.saveKeys?.current ?? "";
  PREVIOUS_SAVE_KEY = config.saveKeys?.previous ?? "";
  OLD_SAVE_KEY = config.saveKeys?.old ?? "";
  FOOT_RADIUS = Number(config.collision?.footRadius) || 12;
  MAX_LEVEL = Number(config.progression?.maxLevel) || 1;
  EVOLUTION_LEVELS = [...(config.progression?.evolutionLevels ?? [])];
  SKILL_LEVELS = [...(config.progression?.skillLevels ?? [])];
  ANIM = { ...(config.anim ?? {}) };
}

// Helper for sprite animation frame index. Reads `anim.<key>` from
// runtime.json (e.g. anim.npc.tickMs / anim.npc.frames). Returns 0 when
// the key is missing.
function animFrame(now, key) {
  const cfg = ANIM?.[key];
  if (!cfg) return 0;
  return Math.floor(now / cfg.tickMs) % cfg.frames;
}

// Battle-strings lookup. Loaded from data/battle-strings.json by
// applyBattleStrings(). Supports `{enemy}` and `{growth}` placeholders.
function applyBattleStrings(data) {
  BATTLE_STRINGS = data || {};
}

// Get a string or array-of-strings template, then substitute placeholders.
// Returns a string OR array (for multi-line dialogue), matching the JSON shape.
function battleString(path, vars = {}) {
  const parts = path.split(".");
  let cur = BATTLE_STRINGS;
  for (const p of parts) {
    cur = cur?.[p];
    if (cur === undefined) return null;
  }
  return substituteVars(cur, vars);
}

function substituteVars(template, vars) {
  if (Array.isArray(template)) return template.map((t) => substituteVars(t, vars));
  if (typeof template !== "string") return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}

function applyAssetManifest(manifest) {
  imagePaths = { ...(manifest.images ?? {}) };
  animationPaths = { ...(manifest.animations ?? {}) };
}

function applyTuningData({ progression, overworld, battle }) {
  PROGRESSION_CONFIG = { ...(progression ?? {}) };
  OVERWORLD_CONFIG = { ...(overworld ?? {}) };
  BATTLE_CONFIG = { ...(battle ?? {}) };
}

function fallbackSpawn() {
  return RUNTIME_CONFIG.spawnFallback ?? { x: 0, y: 0 };
}

function defeatReturnPoint() {
  const config = RUNTIME_CONFIG.defeatReturn ?? {};
  if ((config.sceneSpawnScenes ?? []).includes(state.scene)) return collisionMap?.spawn ?? config.sceneSpawnFallback ?? fallbackSpawn();
  return config.default ?? fallbackSpawn();
}
