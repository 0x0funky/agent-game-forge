const dom = {
  canvas: null,
  ctx: null
};

function initDom() {
  dom.canvas = document.getElementById("game");
  dom.ctx = dom.canvas.getContext("2d");
  dom.ctx.imageSmoothingEnabled = false;
}
