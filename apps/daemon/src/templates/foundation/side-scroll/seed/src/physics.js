function applyGravity(entity, dt) {
  const physics = cfg("physics");
  entity.vy += physics.gravity * dt;
  entity.vy = Math.min(entity.vy, physics.maxFallSpeed);
}

function integrateEntity(entity, dt, colliders) {
  const previous = { x: entity.x, y: entity.y };
  entity.grounded = false;
  entity.x += entity.vx * dt;
  resolveAxis(entity, colliders, "x", previous);
  entity.y += entity.vy * dt;
  resolveAxis(entity, colliders, "y", previous);
}

function resolveAxis(entity, colliders, axis, previous) {
  const rect = bodyRect(entity);
  const previousRect = bodyRect({ ...entity, x: previous.x, y: previous.y });
  for (const col of colliders) {
    if (axis === "x") {
      // Side-scroller platform colliders are top surfaces. Only wall colliders
      // should block horizontal movement, otherwise floors push actors offstage.
      if (col.type !== "wall") continue;
    } else {
      if (col.type !== "platform") continue;
      if (entity.vy > 0) {
        const previousBottom = previousRect.y + previousRect.h;
        const landingTolerance = (entity.bodyInsetY ?? 6) + 4;
        if (previousBottom > col.y + landingTolerance) continue;
      } else if (col.oneWay) {
        continue;
      }
    }
    if (!rectsOverlap(rect, col)) continue;

    if (axis === "x") {
      if (entity.vx > 0) entity.x = col.x - entity.w + (entity.bodyInsetX ?? 10);
      if (entity.vx < 0) entity.x = col.x + col.w - (entity.bodyInsetX ?? 10);
      entity.vx = 0;
    } else {
      let resolved = false;
      if (entity.vy > 0) {
        entity.y = col.y - entity.h;
        entity.grounded = true;
        entity.jumpsLeft = entity.maxJumps;
        resolved = true;
      } else if (!col.oneWay && entity.vy < 0) {
        const previousTop = previousRect.y;
        const colliderBottom = col.y + col.h;
        if (previousTop >= colliderBottom - 4) {
          entity.y = colliderBottom - (entity.bodyInsetY ?? 6);
          resolved = true;
        }
      }
      if (!resolved) continue;
      entity.vy = 0;
    }
    const updated = bodyRect(entity);
    rect.x = updated.x;
    rect.y = updated.y;
  }
}
