function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y;
}

function pointInRect(point, rect) {
  return point.x >= rect.x && point.x <= rect.x + rect.w &&
    point.y >= rect.y && point.y <= rect.y + rect.h;
}

function centerOf(rect) {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function bodyRect(entity) {
  const shrinkX = entity.bodyInsetX ?? 10;
  const shrinkY = entity.bodyInsetY ?? 6;
  return {
    x: entity.x + shrinkX,
    y: entity.y + shrinkY,
    w: entity.w - shrinkX * 2,
    h: entity.h - shrinkY
  };
}
