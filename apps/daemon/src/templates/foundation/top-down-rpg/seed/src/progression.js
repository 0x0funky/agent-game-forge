function starterById(id) {
  return STARTERS.find((starter) => starter.id === id);
}

function mitamaById(id) {
  return starterById(id) || CAPTUREABLE_MITAMA.find((mitama) => mitama.id === id);
}

function defaultInventory() {
  return Object.fromEntries(
    ITEMS.map((item) => [item.id, Math.max(0, Math.floor(Number(item.defaultCount) || 0))]),
  );
}

function normalizeInventory(inventory) {
  const defaults = defaultInventory();
  return Object.fromEntries(
    ITEMS.map((item) => [
      item.id,
      Math.max(0, Math.floor(Number(inventory?.[item.id] ?? defaults[item.id] ?? 0))),
    ]),
  );
}

function itemById(id) {
  return ITEMS.find((item) => item.id === id);
}

function bossDefeated(boss = collisionMap?.boss) {
  if (!boss) return true;
  // boss.flagKey is the post-refactor field; legacy boss.defeatedKey
  // (e.g. "defeatedBoss") is still tolerated by stripping the prefix
  // for older data files that haven't been migrated yet.
  const key = boss.flagKey
    ?? (boss.defeatedKey ? boss.defeatedKey.replace(/^defeated/, "").replace(/^[A-Z]/, (c) => c.toLowerCase()) : "boss");
  return Boolean(state.flags?.[key]);
}

function inventoryCount(id) {
  state.inventory = normalizeInventory(state.inventory);
  return state.inventory[id] ?? 0;
}

function addItem(id, amount = 1) {
  state.inventory = normalizeInventory(state.inventory);
  state.inventory[id] = Math.max(0, (state.inventory[id] ?? 0) + amount);
}

function spendItem(id, amount = 1) {
  if (inventoryCount(id) < amount) return false;
  state.inventory[id] -= amount;
  return true;
}

function normalizeOwnedMitama(ids) {
  const owned = Array.isArray(ids) ? ids.filter((id) => mitamaById(id)) : [];
  if (state.partnerId && mitamaById(state.partnerId) && !owned.includes(state.partnerId)) owned.unshift(state.partnerId);
  return [...new Set(owned)];
}

function addOwnedMitama(id) {
  if (!mitamaById(id)) return false;
  state.ownedMitama = normalizeOwnedMitama(state.ownedMitama);
  if (state.ownedMitama.includes(id)) return false;
  state.ownedMitama.push(id);
  progressFor(id);
  ensurePartnerHp(id);
  return true;
}

function ownedMitamas() {
  state.ownedMitama = normalizeOwnedMitama(state.ownedMitama);
  return state.ownedMitama.map((id) => scaledMitama(mitamaById(id))).filter(Boolean);
}

function aliveOwnedMitamas(excludeId = null) {
  return ownedMitamas().filter((mitama) => mitama.id !== excludeId && ensurePartnerHp(mitama.id) > 0);
}

function ensureBattleReadyPartner() {
  const partner = currentPartner();
  if (partner && ensurePartnerHp(partner.id) > 0) return partner;
  const replacement = aliveOwnedMitamas()[0];
  if (!replacement) return null;
  state.partnerId = replacement.id;
  return replacement;
}

function progressFor(id) {
  if (!state.partnerProgress[id]) state.partnerProgress[id] = { level: 1, xp: 0 };
  state.partnerProgress[id].level = clamp(Math.floor(Number(state.partnerProgress[id].level) || 1), 1, MAX_LEVEL);
  state.partnerProgress[id].xp = Math.max(0, Math.floor(Number(state.partnerProgress[id].xp) || 0));
  return state.partnerProgress[id];
}

function nextLevelXp(level) {
  if (level >= MAX_LEVEL) return Infinity;
  const xp = PROGRESSION_CONFIG.xp ?? {};
  return Math.floor(
    (Number(xp.base) || 0) +
      level * (Number(xp.linear) || 0) +
      Math.pow(level, Number(xp.exponent) || 1) * (Number(xp.powerScale) || 0),
  );
}

function skillFor(starter, level) {
  let index = 0;
  for (let i = 0; i < SKILL_LEVELS.length; i += 1) {
    if (level >= SKILL_LEVELS[i]) index = i;
  }
  return starter.skills[index] ?? starter.skill;
}

function formStageFor(starter, level) {
  if (starter.forms.length <= 1) return 0;
  let index = 0;
  for (let i = 0; i < EVOLUTION_LEVELS.length; i += 1) {
    if (level >= EVOLUTION_LEVELS[i]) index = i;
  }
  return Math.min(index, starter.forms.length - 1);
}

function formFor(starter, level) {
  const index = formStageFor(starter, level);
  return starter.forms[index] ?? { name: starter.name, imageKey: starter.imageKey };
}

function nextEvolutionLevel(starter, level) {
  if (starter.forms.length <= 1) return null;
  return EVOLUTION_LEVELS.find((requiredLevel, index) => index < starter.forms.length && requiredLevel > level) ?? null;
}

function scaledMitama(starter) {
  if (!starter) return null;
  const progress = progressFor(starter.id);
  const level = clamp(progress.level, 1, MAX_LEVEL);
  const form = formFor(starter, level);
  const hasEvolutions = starter.forms.length > 1;
  const formStage = formStageFor(starter, level);
  const growth = level - 1;
  const growthConfig = PROGRESSION_CONFIG.mitamaGrowth ?? {};
  const rates = hasEvolutions ? growthConfig.evolved ?? {} : growthConfig.single ?? {};
  const formRates = growthConfig.formStage ?? {};
  return {
    ...starter,
    baseName: starter.name,
    name: form.name,
    imageKey: form.imageKey,
    level,
    xp: progress.xp,
    skill: skillFor(starter, level),
    maxHp: Math.round(starter.maxHp + growth * (Number(rates.hp) || 0) + formStage * (Number(formRates.hp) || 0)),
    atk: Math.round(starter.atk + growth * (Number(rates.atk) || 0) + formStage * (Number(formRates.atk) || 0)),
    art: Math.round(starter.art + growth * (Number(rates.art) || 0) + formStage * (Number(formRates.art) || 0)),
    guard: Math.round(starter.guard + growth * (Number(rates.guard) || 0) + formStage * (Number(formRates.guard) || 0)),
  };
}

function enemyLevelFor(kind, template) {
  const partyLevel = currentPartner()?.level ?? 1;
  if (kind === "grass") {
    const grass = PROGRESSION_CONFIG.grassLevel ?? {};
    const offset = Math.floor(Math.random() * (Number(grass.offsetRange) || 1)) + (Number(grass.offsetMin) || 0);
    return clamp(partyLevel + offset, Number(grass.min) || 1, Number(grass.max) || MAX_LEVEL);
  }
  return clamp(template.level ?? partyLevel, 1, MAX_LEVEL);
}

function scaledEnemy(template, level) {
  const growth = Math.max(0, level - 1);
  const rates = PROGRESSION_CONFIG.enemyGrowth ?? {};
  const elite = template.capturable ? Number(rates.capturableMultiplier) || 1 : 1;
  return {
    ...template,
    level,
    maxHp: Math.round(template.maxHp + growth * (Number(rates.hp) || 0) * elite),
    atk: Math.round(template.atk + growth * (Number(rates.atk) || 0) * elite),
    art: Math.round(template.art + growth * (Number(rates.art) || 0) * elite),
    guard: Math.round(template.guard + growth * (Number(rates.guard) || 0) * elite),
  };
}

function currentPartner() {
  if (!state.partnerId) return null;
  return scaledMitama(mitamaById(state.partnerId));
}

function ensurePartnerHp(id) {
  const partner = scaledMitama(mitamaById(id));
  if (!partner) return 0;
  if (!Number.isFinite(state.partnerHp[id])) {
    state.partnerHp[id] = partner.maxHp;
  }
  state.partnerHp[id] = clamp(Math.ceil(state.partnerHp[id]), 0, partner.maxHp);
  return state.partnerHp[id];
}

function setPartnerHp(id, hp) {
  const partner = scaledMitama(mitamaById(id));
  if (!partner) return;
  state.partnerHp[id] = clamp(Math.ceil(hp), 0, partner.maxHp);
  updateHud();
}

function healPartner() {
  const owned = ownedMitamas();
  if (!owned.length) return;
  for (const mitama of owned) state.partnerHp[mitama.id] = mitama.maxHp;
  const sealCharm = itemById("sealCharm");
  const restockTarget = Math.max(0, Math.floor(Number(sealCharm?.restockTarget) || 0));
  addItem("sealCharm", Math.max(0, restockTarget - inventoryCount("sealCharm")));
  playSound("heal");
  saveGame();
  state.menuMessage = `同行御魂全員休息完畢，HP 已回復，降伏符補到 ${inventoryCount("sealCharm")} 張。`;
  renderMenu();
}

function isAtRestPoint() {
  if (!collisionMap?.rest) return false;
  const rest = collisionMap.rest;
  return ellipseContains(rest.x, rest.y, rest.rx ?? rest.radius, rest.ry ?? rest.radius, state.player.x, state.player.y);
}

function makeCombatant(template) {
  return {
    ...template,
    hp: template.maxHp,
  };
}

function saveGame() {
  if (!state.partnerId) return;
  localStorage.setItem(
    SAVE_KEY,
    JSON.stringify({
      version: 5,
      partnerId: state.partnerId,
      scene: state.scene,
      flags: state.flags || {},
      x: state.player.x,
      y: state.player.y,
      progress: state.partnerProgress,
      hp: state.partnerHp,
      ownedMitama: normalizeOwnedMitama(state.ownedMitama),
      inventory: normalizeInventory(state.inventory),
      seenDex: state.seenDex,
    }),
  );
  state.lastSavedAt = performance.now();
  updateHud();
}

// ----- Save migration -----
// Each migration function takes a save object and returns a save object
// at the next version. Chain them in order so any old save eventually
// reaches the current shape.

const SAVE_VERSION = 5;

function migrateSave(data) {
  if (!data || typeof data !== "object") return null;
  // Pre-versioned saves had no `version` field; treat as v3 (the oldest
  // shape that might exist in a real player's localStorage).
  let v = Number.isInteger(data.version) ? data.version : 3;
  let out = { ...data };
  while (v < SAVE_VERSION) {
    const migrator = MIGRATIONS[v];
    if (!migrator) break;
    out = migrator(out);
    v += 1;
  }
  out.version = SAVE_VERSION;
  return out;
}

const MIGRATIONS = {
  // v3 → v4: no shape change recorded historically; just bump version
  // (this is where we used to swap the storage key; the data itself
  // didn't change).
  3: (data) => ({ ...data }),
  // v4 → v5: 8 separate `defeatedX` booleans collapsed into a single
  // `flags: {}` object keyed by boss id. See state.js: state.flags.
  4: (data) => {
    if (data.flags && typeof data.flags === "object") return data;
    const flags = {};
    const legacy = [
      ["defeatedGate", "gate"],
      ["defeatedBoss", "boss"],
      ["defeatedTempleApprentice", "templeApprentice"],
      ["defeatedTempleMaster", "templeMaster"],
      ["defeatedMarshBoss", "marshBoss"],
      ["defeatedMistScout", "mistScout"],
      ["defeatedMistGuard", "mistGuard"],
      ["defeatedMistMaster", "mistMaster"],
    ];
    for (const [oldKey, newKey] of legacy) {
      if (data[oldKey]) flags[newKey] = true;
    }
    const out = { ...data, flags };
    // Strip the old fields so we don't keep them around.
    for (const [oldKey] of legacy) delete out[oldKey];
    return out;
  },
};

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY) || localStorage.getItem(PREVIOUS_SAVE_KEY) || localStorage.getItem(OLD_SAVE_KEY);
    if (!raw) return false;
    const rawData = JSON.parse(raw);
    const data = migrateSave(rawData);
    if (!data || !mitamaById(data.partnerId)) return false;
    state.partnerId = data.partnerId;
    state.scene = collisionMaps[data.scene] ? data.scene : "outdoor";
    collisionMap = collisionMaps[state.scene] || collisionMaps.outdoor;
    state.flags = data.flags || {};
    state.player.x = Number.isFinite(data.x) ? data.x : state.player.x;
    state.player.y = Number.isFinite(data.y) ? data.y : state.player.y;
    state.partnerProgress = data.progress && typeof data.progress === "object" ? data.progress : {};
    state.partnerHp = data.hp && typeof data.hp === "object" ? data.hp : {};
    state.ownedMitama = normalizeOwnedMitama(data.ownedMitama);
    state.inventory = normalizeInventory(data.inventory);
    state.seenDex = data.seenDex && typeof data.seenDex === "object" ? data.seenDex : {};
    progressFor(data.partnerId);
    ensurePartnerHp(data.partnerId);
    const safe = findSafePoint(state.player.x, state.player.y);
    state.player.x = safe.x;
    state.player.y = safe.y;
    return true;
  } catch {
    return false;
  }
}
