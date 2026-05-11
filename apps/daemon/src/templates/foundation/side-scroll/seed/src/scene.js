let levelsManifest = null;

async function loadGameData() {
  levelsManifest = await loadJSON("data/levels.json");
}

async function switchScene(sceneId, options = {}) {
  const entry = levelsManifest.levels.find((level) => level.id === sceneId);
  if (!entry) throw new Error("Unknown scene: " + sceneId);
  const level = await loadJSON(entry.file);
  state.sceneId = sceneId;
  state.level = level;
  state.projectiles.length = 0;
  state.attacks.length = 0;
  await preloadSceneAssets(level);
  buildSceneRuntime(level, options);
  if (options.keepMode !== true && state.mode !== "title") state.mode = "playing";
}

async function preloadSceneAssets(level) {
  const layerPaths = (level.layers || []).map((layer) => layer.image);
  const platformPaths = [];
  for (const lib of Object.values(level.shared_platform_library || {})) {
    if (lib.left) platformPaths.push(lib.left.image);
    if (lib.mid) platformPaths.push(lib.mid.image);
    if (lib.right) platformPaths.push(lib.right.image);
  }
  await preloadImageList(layerPaths.concat(platformPaths));

  const playerAnims = Object.values(cfg("player").animations || {});
  const enemyAnims = (catalogs.enemies || []).flatMap((enemy) => Object.values(enemy.animations || {}));
  await Promise.all(playerAnims.concat(enemyAnims).map(preloadSpriteAnimation));

  const spritePaths = []
    .concat((catalogs.pickups || []).map((p) => p.sprite))
    .concat((catalogs.hazards || []).map((h) => h.sprite))
    .concat((catalogs.projectiles || []).map((p) => p.sprite));
  await preloadImageList(spritePaths);
}

function buildSceneRuntime(level, options) {
  const spawn = options.spawn || (level.spawn_points || [])[0] || { x: 80, y: 520 };
  if (!state.player || options.newPlayer) createPlayerAt(spawn);
  else {
    state.player.x = spawn.x;
    state.player.y = spawn.y;
    state.player.vx = 0;
    state.player.vy = 0;
  }
  state.checkpoint = { x: spawn.x, y: spawn.y };
  state.enemies = (level.enemies || []).map(buildEnemyInstance).filter(Boolean);
  state.pickups = (level.pickups || []).map((entry) => {
    const type = byId("pickups", entry.type) || {};
    return { ...entry, ...type, w: entry.w || type.size?.w || 44, h: entry.h || type.size?.h || 44, collected: false };
  });
  state.hazards = (level.hazards || []).map((entry) => {
    const type = byId("hazards", entry.type) || {};
    return { ...entry, ...type, w: entry.w || type.size?.w || entry.w, h: entry.h || type.size?.h || entry.h };
  });
  state.camera.x = level.camera?.x || 0;
  state.camera.y = level.camera?.y || 0;
  state.camera.snapY = state.camera.y;
}

async function startNewRun() {
  resetRunState();
  await switchScene(GAME.startScene, { newPlayer: true });
  triggerStory("intro", "Smoke hides the pass. Reach the allied gate before the rebel banner rises.");
  ensureAudio();
}

function updateScene(dt) {
  if (state.mode !== "playing") return;
  state.runTime += dt;
  updatePlayer(dt);
  updateEnemies(dt);
  updateProjectiles(dt);
  updateAttacks(dt);
  updatePickups();
  updateHazards();
  updateStoryZones();
  updateExits();
  updateCamera(dt);
}

function updatePickups() {
  const pRect = bodyRect(state.player);
  for (const pickup of state.pickups) {
    if (pickup.collected || !rectsOverlap(pRect, pickup)) continue;
    pickup.collected = true;
    if (pickup.effect?.heal) state.player.hp = Math.min(state.player.maxHp, state.player.hp + pickup.effect.heal);
    if (pickup.effect?.score) state.score += pickup.effect.score;
    if (pickup.id === "war_order" || pickup.type === "war_order") state.flags.warOrderCollected = true;
    burstParticles(pickup.x + pickup.w / 2, pickup.y + pickup.h / 2, 8, COLORS.jade);
    playSfx("pickup");
  }
}

function updateHazards() {
  const pRect = bodyRect(state.player);
  // hazards[] = visible damage entries (sprite + rect). Each has effect
  // (kill / damage) and optional damage amount.
  for (const hazard of state.hazards) {
    if (!rectsOverlap(pRect, hazard)) continue;
    if (hazard.effect === "kill") loseLife();
    else damagePlayer(hazard.damage || 1, state.player.x < hazard.x ? -1 : 1);
  }
  // Invisible damage/kill colliders from level.colliders[] — used for
  // pit-kill zones (player falls into) and damage rects (independent of
  // a visible hazard sprite). Single source of truth: any collider whose
  // type is "hazard" or "kill" triggers here.
  for (const col of damageColliders(state.level)) {
    if (!rectsOverlap(pRect, col)) continue;
    if (col.type === "kill") loseLife();
    else damagePlayer(col.damage || 1, state.player.x < col.x ? -1 : 1);
  }
}

function updateStoryZones() {
  const center = centerOf(bodyRect(state.player));
  for (const trigger of state.level.storyTriggers || []) {
    if (state.storyTriggers[trigger.id]) continue;
    if (pointInRect(center, trigger.rect)) triggerStory(trigger.id, trigger.text);
  }
  for (const checkpoint of state.level.checkpoints || []) {
    if (pointInRect(center, checkpoint)) {
      state.checkpoint = { x: checkpoint.x, y: checkpoint.y - state.player.h };
      if (state.lastCheckpointId !== checkpoint.id) {
        state.lastCheckpointId = checkpoint.id;
        triggerStory("checkpoint_" + checkpoint.id, "The checkpoint banner is yours.");
      }
    }
  }
}

function updateExits() {
  const center = centerOf(bodyRect(state.player));
  for (const exit of state.level.exits || []) {
    if (!pointInRect(center, exit)) continue;
    if (exit.requiresBossDefeated && !state.flags.bossDefeated) {
      triggerStory("gate_locked", "The gate captain still holds the pass.");
      return;
    }
    if (exit.target === "win") {
      state.mode = "win";
      state.endingText = "The ash road opens. The allied banner survives.";
      playSfx("victory");
      return;
    }
    state.mode = "transition";
    switchScene(exit.target, { newPlayer: false, spawn: exit.spawn || null }).then(() => {
      state.mode = "playing";
      if (exit.target === GAME.bossScene) {
        showMessage("Gate Captain Masamune: No ronin passes my banner.", 4);
        playSfx("boss");
      }
    }).catch((err) => {
      state.error = err;
      state.mode = "gameover";
    });
    return;
  }
}
