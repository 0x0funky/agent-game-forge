function drawParallax(ctx, level) {
  const layers = (level.layers || []).slice().sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  for (const layer of layers) {
    const img = assetCache.images.get(layer.image);
    if (!img || img instanceof Promise) continue;
    const scroll = layer.parallax ?? 1;
    ctx.save();
    ctx.globalAlpha = layer.opacity ?? 1;
    if (layer.repeatX) {
      const offset = -((state.camera.x * scroll) % img.width);
      for (let x = offset - img.width; x < VIEW.w + img.width; x += img.width) {
        ctx.drawImage(img, Math.round(x), 0, img.width, VIEW.h);
      }
    } else {
      ctx.drawImage(img, worldToScreenX(0, scroll), worldToScreenY(0, scroll), level.mapSize.width, level.mapSize.height);
    }
    ctx.restore();
  }
}
