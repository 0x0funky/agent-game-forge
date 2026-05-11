const config = {};

async function loadConfigs() {
  const entries = [
    ["player", "data/player-config.json"],
    ["physics", "data/physics-config.json"],
    ["camera", "data/camera-config.json"],
    ["audio", "data/audio-config.json"],
    ["hud", "data/hud-config.json"]
  ];
  await Promise.all(entries.map(async ([key, path]) => {
    config[key] = await loadJSON(path);
  }));
}

function cfg(key) {
  return config[key] || {};
}
