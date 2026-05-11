const assetCache = {
  json: new Map(),
  images: new Map(),
  meta: new Map()
};

async function loadJSON(path) {
  if (assetCache.json.has(path)) return assetCache.json.get(path);
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) throw new Error("Could not load " + path + " (" + response.status + ")");
  const data = await response.json();
  assetCache.json.set(path, data);
  return data;
}

function loadImage(path) {
  if (!path) return Promise.resolve(null);
  if (assetCache.images.has(path)) return assetCache.images.get(path);
  const promise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      assetCache.images.set(path, img);
      resolve(img);
    };
    img.onerror = () => {
      console.warn("Could not load image", path);
      assetCache.images.set(path, null);
      resolve(null);
    };
    img.src = path;
  });
  assetCache.images.set(path, promise);
  return promise;
}

async function loadMetaForSprite(path) {
  if (!path) return DEFAULT_ANIM;
  const metaPath = path.replace(/[^/]+$/, "pipeline-meta.json");
  if (assetCache.meta.has(metaPath)) return assetCache.meta.get(metaPath);
  try {
    const meta = await loadJSON(metaPath);
    const anim = normalizeMeta(meta);
    assetCache.meta.set(metaPath, anim);
    return anim;
  } catch (err) {
    const fallback = { ...DEFAULT_ANIM };
    assetCache.meta.set(metaPath, fallback);
    return fallback;
  }
}

function normalizeMeta(meta) {
  const cell = meta.cell_size || meta.single_size || 128;
  const rows = meta.rows || 1;
  const cols = meta.cols || 1;
  const frameCount = Array.isArray(meta.frames)
    ? meta.frames.length
    : Number(meta.frames) || (rows * cols);
  return {
    frameW: meta.frameW || cell,
    frameH: meta.frameH || cell,
    frames: frameCount,
    cols,
    rows,
    fps: meta.fps || (meta.duration ? Math.max(1, Math.round(1000 / meta.duration)) : 8),
    cellSize: cell
  };
}

async function preloadSpriteAnimation(anim) {
  if (!anim || !anim.sprite) return;
  const [image, meta] = await Promise.all([loadImage(anim.sprite), loadMetaForSprite(anim.sprite)]);
  anim.image = image;
  anim.meta = meta;
}

async function preloadImageList(paths) {
  await Promise.all(paths.filter(Boolean).map((path) => loadImage(path)));
}

function getCachedImage(path) {
  const item = assetCache.images.get(path);
  return item && item instanceof Promise ? null : item;
}
