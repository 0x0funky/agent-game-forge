const VIEW = Object.freeze({ w: 1280, h: 720 });

const GAME = Object.freeze({
  title: "Ash Banner Road",
  startScene: "border_road",
  bossScene: "gate_boss_room",
  startMode: "title"
});

const COLORS = Object.freeze({
  ink: "#120d0b",
  panel: "rgba(18, 13, 11, 0.82)",
  panelEdge: "#6f3b25",
  text: "#f2e7d0",
  muted: "#b49c7b",
  hp: "#d9362b",
  hpBack: "#39201c",
  gold: "#e5b84a",
  jade: "#2fa66a",
  smoke: "#6c6558",
  platformTop: "#5c5141",
  platformFace: "#2a1b16"
});

const DEFAULT_ANIM = Object.freeze({
  frameW: 128,
  frameH: 128,
  frames: 1,
  cols: 1,
  rows: 1,
  fps: 1
});
