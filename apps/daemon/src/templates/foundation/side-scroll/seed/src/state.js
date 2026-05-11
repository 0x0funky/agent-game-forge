const state = {
  mode: "loading",
  sceneId: null,
  level: null,
  camera: { x: 0, y: 0, lookahead: 0, snapY: 0, shake: 0, shakeT: 0 },
  time: 0,
  runTime: 0,
  score: 0,
  flags: {
    bossDefeated: false,
    warOrderCollected: false
  },
  player: null,
  enemies: [],
  projectiles: [],
  attacks: [],
  particles: [],
  pickups: [],
  hazards: [],
  storyTriggers: {},
  checkpoint: null,
  lastCheckpointId: null,
  message: null,
  titleBlink: 0,
  endingText: "",
  error: null
};

function resetRunState() {
  state.mode = "playing";
  state.time = 0;
  state.runTime = 0;
  state.score = 0;
  state.flags.bossDefeated = false;
  state.flags.warOrderCollected = false;
  state.projectiles.length = 0;
  state.attacks.length = 0;
  state.particles.length = 0;
  state.storyTriggers = {};
  state.lastCheckpointId = null;
  state.message = null;
  state.endingText = "";
}
