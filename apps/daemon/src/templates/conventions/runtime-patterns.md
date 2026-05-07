# Runtime patterns — universal across all 2D genres

These eight patterns appear in every 2D game. Don't reinvent them per project — they have decades of established practice. Genre files reference these by name; this file holds the canonical implementation.

## 1. Frame-rate independence (delta time)

Every position update uses elapsed time, not frame count:

```js
function update(now) {
  const dt = (now - lastNow) / 1000; // seconds since last frame
  lastNow = now;
  player.x += player.vx * dt;
  player.y += player.vy * dt;
  requestAnimationFrame(update);
}
```

**Anti-pattern**: `velocity *= 0.9` per frame for friction — feels different at 30fps vs 60fps vs 120fps. Use `velocity *= Math.exp(-friction * dt)` or apply drag per-second.

Reference: [Gaffer On Games — Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/).

## 2. Fixed-timestep physics (when determinism matters)

Most arcade games can use variable dt (#1 above). Physics-driven puzzles or networked games need a fixed step:

```js
const STEP = 1/60; // 16.67ms physics tick
let accumulator = 0;
function update(dt) {
  accumulator += dt;
  while (accumulator >= STEP) {
    simulate(STEP);
    accumulator -= STEP;
  }
  render(accumulator / STEP); // interpolate for smooth display
}
```

Skip this for V1 unless physics-correctness matters. Variable-dt is fine for action games.

## 3. AABB collision (broad + narrow)

Two rectangles collide if and only if they overlap on both axes:

```js
function rectsOverlap(a, b) {
  return a.x < b.x + b.w &&
         a.x + a.w > b.x &&
         a.y < b.y + b.h &&
         a.y + a.h > b.y;
}
```

For fast-moving objects (bullets, falling player), do **swept AABB** to prevent tunneling — compute the line of motion, check if any side of the other box intersects:

Reference: [MDN — 2D collision detection](https://developer.mozilla.org/en-US/docs/Games/Techniques/2D_collision_detection), [noonat — Intersection Tests in 2D](https://noonat.github.io/intersect/).

**Always shrink the body**: a 32×48 sprite usually has a 18×40 collision box, centered. Prevents corner snags and feels fair.

## 4. Sprite animation from elapsed time

Frame index is derived from time, not from a per-frame counter — survives variable framerate:

```js
function getFrameIndex(elapsedSec, fps, frameCount) {
  return Math.floor(elapsedSec * fps) % frameCount;
}

function drawSprite(ctx, sheet, anim, x, y, t) {
  const frame = getFrameIndex(t, anim.fps, anim.frames);
  const col = frame % anim.cols;
  const row = Math.floor(frame / anim.cols);
  ctx.drawImage(
    sheet,
    col * anim.frameW, row * anim.frameH, anim.frameW, anim.frameH,
    x, y, anim.frameW, anim.frameH
  );
}
```

`anim.frames` / `cols` / `rows` / `frameW` / `frameH` / `fps` come from the sheet's `pipeline-meta.json` written by `generate2dsprite`. Don't hand-set these.

## 5. Object pooling

For anything spawned more than ~1×/sec (bullets, particles, pickups, enemies in survivor games), pre-allocate N and reuse:

```js
class BulletPool {
  constructor(size = 200) {
    this.pool = Array.from({length: size}, () => ({active: false, x: 0, y: 0, vx: 0, vy: 0}));
  }
  spawn(x, y, vx, vy) {
    const b = this.pool.find(b => !b.active);
    if (!b) return null; // pool exhausted
    b.active = true; b.x = x; b.y = y; b.vx = vx; b.vy = vy;
    return b;
  }
  release(b) { b.active = false; }
  forEach(fn) { for (const b of this.pool) if (b.active) fn(b); }
}
```

**Anti-pattern**: `new Bullet()` per shot → GC stutter at 60+ shots/sec.

## 6. Y-sort / depth ordering (top-down genres)

Top-down games need dynamic objects to render in Y order so a player walking behind a tree appears behind it:

```js
function renderEntities(ctx, entities) {
  entities.sort((a, b) => a.y - b.y); // higher-y → drawn later → on top
  for (const e of entities) e.draw(ctx);
}
```

Static layers (ground tilemap, ceiling overlay) get fixed depth — they don't participate in dynamic Y-sort.

Reference: [Phaser z-order tutorial](https://phaser.io/news/2016/03/z-order-tutorial).

Side-scroll genres typically use static z-index (background layers always behind, foreground always front) — Y-sort isn't needed.

## 7. Camera scroll factor (parallax + UI separation)

Every drawable has a "scroll factor": how much the camera affects its draw position.

- `scrollFactor = 0` → element ignores camera (HUD, score, fixed UI)
- `scrollFactor = 0.1..0.9` → parallax background (far layers small factor, near layers big factor)
- `scrollFactor = 1.0` → world entities (player, enemies, level geometry)
- `scrollFactor > 1.0` → foreground occluders (closer than the player)

```js
function worldToScreen(worldX, scrollFactor = 1) {
  return worldX - camera.x * scrollFactor;
}
```

This single primitive replaces three different "stay-on-screen vs scroll-with-world" implementations. **Use it everywhere** instead of conditionals like `if (isHud) drawAt(...) else drawAt(...)`.

Reference: Phaser's `setScrollFactor` API (built-in), our convention follows the same shape for vanilla JS.

## 8. Finite state machine for animation + behavior

Switch statements in `update()` collapse past 3 states. Use an FSM:

```js
const states = {
  idle: {
    enter(e) { e.anim = 'idle'; },
    update(e, dt) {
      if (e.input.left || e.input.right) return 'walk';
      if (e.input.jump) return 'jump';
    }
  },
  walk: {
    enter(e) { e.anim = 'walk'; },
    update(e, dt) {
      const dir = e.input.right ? 1 : (e.input.left ? -1 : 0);
      e.vx = dir * e.speed;
      if (dir === 0) return 'idle';
      if (e.input.jump) return 'jump';
    }
  },
  jump: { /* ... */ }
};

function tick(e, dt) {
  const next = states[e.state].update(e, dt);
  if (next && next !== e.state) {
    states[e.state].exit?.(e);
    e.state = next;
    states[next].enter?.(e);
  }
}
```

Player gets one FSM, each enemy kind gets one, the boss gets one. Reference: [Ourcade — State Pattern in Phaser 3](https://blog.ourcade.co/posts/2020/state-pattern-character-movement-phaser-3/).

## When to break out a runtime helper file

Each pattern above probably starts inline in `src/scene.js` or `src/entities/<x>.js`. Promote to `src/<pattern>.js` when:

- Two or more files use it (e.g. AABB used by player + enemies + projectiles → `src/collision.js`).
- The implementation grows past ~30 lines.

Conventional homes for these in OGF web projects:

| Pattern | Lives in |
|---|---|
| Frame loop + delta time | `src/game.js` (entry point owns the rAF loop) |
| AABB collision | `src/collision.js` |
| Sprite animation | `src/render.js` (or `src/anim.js` if rich) |
| Object pool | `src/entities/<thing>.js` (pool per kind, not generic) |
| Y-sort | `src/render.js` (if the genre needs it) |
| Camera + scroll factor | `src/render.js` |
| FSM | inline in entity file (player FSM in `src/entities/player.js`) |
