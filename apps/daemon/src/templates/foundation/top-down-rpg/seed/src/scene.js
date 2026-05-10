function sx(x) {
  return (x - CAMERA.x) * CAMERA.scale;
}

function sy(y) {
  return (y - CAMERA.y) * CAMERA.scale;
}

function fullSx(x) {
  return (x / MAP.w) * VIEW.w;
}

function fullSy(y) {
  return (y / MAP.h) * VIEW.h;
}

function updateCamera() {
  CAMERA.x = clamp(state.player.x - CAMERA.w / 2, 0, MAP.w - CAMERA.w);
  CAMERA.y = clamp(state.player.y - CAMERA.h / 2, 0, MAP.h - CAMERA.h);
  CAMERA.scale = VIEW.w / CAMERA.w;
}

function currentSceneName() {
  return SCENE_NAMES[state.scene] ?? SCENE_NAMES.outdoor;
}

function currentSceneMapKey() {
  return SCENE_MAP_KEYS[state.scene] ?? SCENE_MAP_KEYS.outdoor;
}

function setScene(scene, point = null) {
  if (!collisionMaps[scene]) return;
  state.scene = scene;
  collisionMap = collisionMaps[scene];
  state.sceneExitCooldown = 0.35;
  playSound("scene");
  startSceneMusic();
  const spawn = point || collisionMap.spawn || fallbackSpawn();
  state.player.x = spawn.x;
  state.player.y = spawn.y;
  state.encounterCharge = 0;
  if (!isWalkable(state.player.x, state.player.y)) {
    const safe = findSafePoint(state.player.x, state.player.y);
    state.player.x = safe.x;
    state.player.y = safe.y;
  }
  updateHud();
}
