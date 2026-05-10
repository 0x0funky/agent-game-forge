function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Lightweight collision-map validator. Catches the 2 categories that
// silently broke past data files: duplicate top-level keys (last-write-
// wins on JSON.parse so the bug hides) and missing required fields. Run
// once at scene load. Logs warnings; never throws.
function validateCollisionMap(map) {
  if (!map || typeof map !== "object") {
    console.warn("[collision-map] missing/invalid map");
    return;
  }
  const required = ["id", "background", "mapSize", "spawn"];
  for (const key of required) {
    if (!(key in map)) console.warn(`[collision-map] '${map.id ?? "?"}' missing required: ${key}`);
  }
  // Spawn / npc / rest / boss must have finite x/y when present.
  for (const key of ["spawn", "npc", "rest", "boss"]) {
    const obj = map[key];
    if (!obj) continue;
    if (!Number.isFinite(obj.x) || !Number.isFinite(obj.y)) {
      console.warn(`[collision-map] '${map.id}' ${key}.x/y not finite`);
    }
  }
  // mapSize.width/height must be finite + positive.
  const ms = map.mapSize ?? {};
  if (!(Number.isFinite(ms.width) && ms.width > 0 && Number.isFinite(ms.height) && ms.height > 0)) {
    console.warn(`[collision-map] '${map.id}' mapSize invalid:`, ms);
  }
}

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function rectContains(rect, x, y) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function ellipseContains(cx, cy, rx, ry, x, y) {
  const nx = (x - cx) / rx;
  const ny = (y - cy) / ry;
  return nx * nx + ny * ny <= 1;
}

function pointInPolygon(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function shapeContains(shape, x, y) {
  if (shape.type === "rect") return rectContains(shape, x, y);
  if (shape.type === "ellipse") return ellipseContains(shape.x, shape.y, shape.rx, shape.ry, x, y);
  if (shape.type === "polygon") return pointInPolygon(shape.points, x, y);
  return false;
}

function sampleFootPoints(x, y, radius = FOOT_RADIUS) {
  return [
    [x, y],
    [x - radius, y],
    [x + radius, y],
    [x, y - radius * 0.62],
    [x, y + radius * 0.78],
  ];
}

function isWalkable(x, y) {
  if (!collisionMap) return true;
  const samples = sampleFootPoints(x, y);
  const inBounds = (px, py) => collisionMap.walkBounds.some((shape) => shapeContains(shape, px, py));
  const blocked = (px, py) => collisionMap.blockers.some((shape) => shapeContains(shape, px, py));
  if (!samples.every(([px, py]) => inBounds(px, py) && !blocked(px, py))) return false;
  const npc = collisionMap.npc;
  if (npc) {
    const collisionRadius = npc.collisionRadius ?? npc.radius ?? 20;
    if (distance(x, y, npc.x, npc.y) <= collisionRadius + FOOT_RADIUS) return false;
  }
  const boss = collisionMap.boss;
  if (boss && !bossDefeated(boss)) {
    const bossRadius = boss.collisionRadius ?? boss.radius ?? 28;
    if (distance(x, y, boss.x, boss.y) <= bossRadius + FOOT_RADIUS) return false;
  }
  for (const trainer of collisionMap.trainers ?? []) {
    const radius = trainer.collisionRadius ?? trainer.radius ?? 24;
    if (distance(x, y, trainer.x, trainer.y) <= radius + FOOT_RADIUS) return false;
  }
  return true;
}

function findSafePoint(x, y) {
  if (isWalkable(x, y)) return { x, y };
  const spawn = collisionMap?.spawn ?? { x: 836, y: 782 };
  if (isWalkable(spawn.x, spawn.y)) return { ...spawn };
  for (let radius = 24; radius <= 260; radius += 24) {
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
      const px = spawn.x + Math.cos(angle) * radius;
      const py = spawn.y + Math.sin(angle) * radius;
      if (isWalkable(px, py)) return { x: px, y: py };
    }
  }
  return { x: 836, y: 782 };
}
