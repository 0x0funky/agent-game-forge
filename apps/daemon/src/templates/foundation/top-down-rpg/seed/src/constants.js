const DIR_ROWS = { down: 0, left: 1, right: 2, up: 3 };
const TOUCH_MOVE_KEYS = ["arrowleft", "arrowright", "arrowup", "arrowdown"];
const FX_KEYS = { fire: "fxFire", water: "fxWater", earth: "fxEarth", shadow: "fxShadow" };
let MENU_ITEMS = [];
let SCENE_NAMES = {};
let SCENE_MAP_KEYS = {};

function applyUiData(ui) {
  MENU_ITEMS = [...(ui.menuItems ?? [])];
}

function applyLevelMetadata(levels) {
  SCENE_NAMES = Object.fromEntries(levels.map((level) => [level.id, level.name ?? level.id]));
  SCENE_MAP_KEYS = Object.fromEntries(levels.map((level) => [level.id, level.mapKey ?? level.id]));
}

// Props are data, not code: each scene JSON owns its `props` array.
// Schema: { id, image, x, y, w, h, sortY? } with bottom-center prop anchors.
