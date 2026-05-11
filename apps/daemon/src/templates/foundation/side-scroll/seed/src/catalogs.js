const catalogs = {};

async function loadCatalogs() {
  const entries = [
    ["enemies", "data/enemies.json"],
    ["pickups", "data/pickups.json"],
    ["hazards", "data/hazards.json"],
    ["projectiles", "data/projectiles.json"],
    ["items", "data/items.json"]
  ];
  await Promise.all(entries.map(async ([key, path]) => {
    catalogs[key] = await loadJSON(path);
  }));
}

function byId(listName, id) {
  return (catalogs[listName] || []).find((entry) => entry.id === id) || null;
}
