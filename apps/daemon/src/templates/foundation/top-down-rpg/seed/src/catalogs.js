let STARTERS = [];
let GATE_ENEMY = null;
let WILD_ENEMIES = [];
let MARSH_WILD_ENEMIES = [];
let HIDDEN_MARSH_ENEMY = null;
let BOSS_ENEMY = null;
let MARSH_BOSS_ENEMY = null;
let TEMPLE_APPRENTICE_MITAMA = null;
let TEMPLE_MASTER_MITAMA = null;
let MIST_SCOUT_MITAMA = null;
let MIST_GUARD_MITAMA = null;
let MIST_MASTER_MITAMA = null;
let POKEDEX_ENEMIES = [];
let CAPTUREABLE_MITAMA = [];
let ITEMS = [];

function applyCatalogData({ starters, enemies, items }) {
  STARTERS = [...(starters ?? [])];
  GATE_ENEMY = enemies?.gate ?? null;
  WILD_ENEMIES = [...(enemies?.wild ?? [])];
  MARSH_WILD_ENEMIES = [...(enemies?.marshWild ?? [])];
  HIDDEN_MARSH_ENEMY = enemies?.hiddenMarsh ?? null;
  BOSS_ENEMY = enemies?.boss ?? null;
  MARSH_BOSS_ENEMY = enemies?.marshBoss ?? null;
  TEMPLE_APPRENTICE_MITAMA = enemies?.templeApprentice ?? null;
  TEMPLE_MASTER_MITAMA = enemies?.templeMaster ?? null;
  MIST_SCOUT_MITAMA = enemies?.mistScout ?? null;
  MIST_GUARD_MITAMA = enemies?.mistGuard ?? null;
  MIST_MASTER_MITAMA = enemies?.mistMaster ?? null;
  ITEMS = [...(items ?? [])];

  POKEDEX_ENEMIES = [
    GATE_ENEMY,
    ...WILD_ENEMIES,
    BOSS_ENEMY,
    TEMPLE_APPRENTICE_MITAMA,
    TEMPLE_MASTER_MITAMA,
    ...MARSH_WILD_ENEMIES,
    HIDDEN_MARSH_ENEMY,
    MARSH_BOSS_ENEMY,
    MIST_MASTER_MITAMA,
  ].filter(Boolean);
  CAPTUREABLE_MITAMA = POKEDEX_ENEMIES.filter((enemy) => enemy.capturable);
}
