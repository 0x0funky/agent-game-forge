function updateOverworld(dt) {
  state.sceneExitCooldown = Math.max(0, state.sceneExitCooldown - dt);
  let dx = 0;
  let dy = 0;
  if (state.keys.has("arrowleft") || state.keys.has("a")) dx -= 1;
  if (state.keys.has("arrowright") || state.keys.has("d")) dx += 1;
  if (state.keys.has("arrowup") || state.keys.has("w")) dy -= 1;
  if (state.keys.has("arrowdown") || state.keys.has("s")) dy += 1;

  if (!isWalkable(state.player.x, state.player.y)) {
    const safe = findSafePoint(state.player.x, state.player.y);
    state.player.x = safe.x;
    state.player.y = safe.y;
  }
  if (trySceneExit()) return;

  state.player.moving = Boolean(dx || dy);
  if (!state.player.moving) return;

  const length = Math.hypot(dx, dy) || 1;
  dx /= length;
  dy /= length;
  state.player.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";

  const movement = OVERWORLD_CONFIG.movement ?? {};
  const bounds = movement.bounds ?? {};
  const speed = Number(movement.speed) || 0;
  const nextX = clamp(
    state.player.x + dx * speed * dt,
    Number(bounds.minX) || 0,
    MAP.w - (Number(bounds.maxXInset) || 0),
  );
  const nextY = clamp(
    state.player.y + dy * speed * dt,
    Number(bounds.minY) || 0,
    MAP.h - (Number(bounds.maxYInset) || 0),
  );
  if (isWalkable(nextX, state.player.y)) state.player.x = nextX;
  if (isWalkable(state.player.x, nextY)) state.player.y = nextY;

  if (trySceneExit()) return;
  checkEncounters(dt);
}

function checkEncounters(dt) {
  if (!state.partnerId || !["outdoor", "mistMarsh"].includes(state.scene)) return;
  const inTraining = state.scene === "outdoor" && rectContains(collisionMap.zones.training, state.player.x, state.player.y);
  if (inTraining && !state.flags?.gate) {
    startBattle("gate");
    return;
  }
  const inHidden = state.scene === "mistMarsh" && rectContains(collisionMap.zones.hidden, state.player.x, state.player.y);
  const inGrass =
    rectContains(collisionMap.zones.grass, state.player.x, state.player.y) ||
    (collisionMap.zones.grassEast && rectContains(collisionMap.zones.grassEast, state.player.x, state.player.y));
  const hiddenEncounter = OVERWORLD_CONFIG.encounters?.hidden ?? {};
  const grassEncounter = OVERWORLD_CONFIG.encounters?.grass ?? {};
  if (inHidden) {
    state.encounterCharge += dt;
    if (state.encounterCharge > (Number(hiddenEncounter.charge) || 0) && Math.random() < (Number(hiddenEncounter.chance) || 0)) {
      state.encounterCharge = 0;
      startBattle(hiddenEncounter.battleKind ?? "mistHidden");
    }
  } else if (inGrass) {
    state.encounterCharge += dt;
    if (state.encounterCharge > (Number(grassEncounter.charge) || 0) && Math.random() < (Number(grassEncounter.chance) || 0)) {
      state.encounterCharge = 0;
      startBattle(state.scene === "mistMarsh" ? grassEncounter.marshBattleKind ?? "mistGrass" : grassEncounter.outdoorBattleKind ?? "grass");
    }
  } else {
    state.encounterCharge = Math.max(0, state.encounterCharge - dt);
  }
}

function battleReturnPoint(kind) {
  const current = { x: state.player.x, y: state.player.y };
  if (kind !== "gate" || !collisionMap?.zones?.training) return current;

  const zone = collisionMap.zones.training;
  if (!rectContains(zone, current.x, current.y)) return current;

  const gateReturn = OVERWORLD_CONFIG.gateReturn ?? {};
  const offsetCandidates = (gateReturn.offsetCandidates ?? []).map((candidate) => ({
    x: zone.x + (Number(candidate.x) || 0),
    y: candidate.y === "current" ? current.y : zone.y + zone.h * (Number(candidate.zoneYFactor) || 0),
  }));
  const candidates = [...offsetCandidates, ...(gateReturn.fallbackPoints ?? [])];

  return candidates.find((point) => isWalkable(point.x, point.y) && !rectContains(zone, point.x, point.y)) || findSafePoint(current.x, current.y);
}

function chooseWildEnemy() {
  return WILD_ENEMIES[Math.floor(Math.random() * WILD_ENEMIES.length)];
}

function chooseMarshWildEnemy() {
  return MARSH_WILD_ENEMIES[Math.floor(Math.random() * MARSH_WILD_ENEMIES.length)];
}

function enemyTemplateForBattle(kind) {
  if (kind === "boss") return BOSS_ENEMY;
  if (kind === "marshBoss") return MARSH_BOSS_ENEMY;
  if (kind === "templeApprentice") return TEMPLE_APPRENTICE_MITAMA;
  if (kind === "templeMaster") return TEMPLE_MASTER_MITAMA;
  if (kind === "mistScout") return MIST_SCOUT_MITAMA;
  if (kind === "mistGuard") return MIST_GUARD_MITAMA;
  if (kind === "mistMaster") return MIST_MASTER_MITAMA;
  if (kind === "mistHidden") return HIDDEN_MARSH_ENEMY;
  if (kind === "mistGrass") return chooseMarshWildEnemy();
  if (kind === "grass") return chooseWildEnemy();
  return GATE_ENEMY;
}
