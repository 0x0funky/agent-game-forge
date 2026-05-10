const audio = {
  ctx: null,
  master: null,
  musicGain: null,
  sfxGain: null,
  musicTimer: null,
  musicTheme: "",
  step: 0,
  enabled: false,
};

let MUSIC_THEMES = {};
let AUDIO_CONFIG = {};

function applyMusicThemes(themes) {
  MUSIC_THEMES = { ...(themes ?? {}) };
}

function applyAudioConfig(config) {
  AUDIO_CONFIG = { ...(config ?? {}) };
}

function ensureAudio() {
  if (audio.ctx) {
    if (audio.ctx.state === "suspended") audio.ctx.resume();
    return;
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  audio.ctx = new AudioContextClass();
  audio.master = audio.ctx.createGain();
  audio.musicGain = audio.ctx.createGain();
  audio.sfxGain = audio.ctx.createGain();
  audio.master.gain.value = Number(AUDIO_CONFIG.gains?.master) || 0;
  audio.musicGain.gain.value = Number(AUDIO_CONFIG.gains?.music) || 0;
  audio.sfxGain.gain.value = Number(AUDIO_CONFIG.gains?.sfx) || 0;
  audio.musicGain.connect(audio.master);
  audio.sfxGain.connect(audio.master);
  audio.master.connect(audio.ctx.destination);
  audio.enabled = true;
  audio.ctx.resume?.();
  startSceneMusic();
}

function audioNow() {
  return audio.ctx?.currentTime ?? 0;
}

function playTone(freq, duration = 0.18, options = {}) {
  if (!audio.ctx || !audio.enabled) return;
  const now = audioNow() + (options.delay ?? 0);
  const osc = audio.ctx.createOscillator();
  const gain = audio.ctx.createGain();
  const filter = audio.ctx.createBiquadFilter();
  osc.type = options.type ?? "sine";
  osc.frequency.setValueAtTime(freq, now);
  if (options.endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, options.endFreq), now + duration);
  filter.type = "lowpass";
  filter.frequency.value = options.cutoff ?? 1600;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(options.volume ?? 0.12, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(options.bus ?? audio.sfxGain);
  osc.start(now);
  osc.stop(now + duration + 0.03);
}

function playNoise(duration = 0.16, options = {}) {
  if (!audio.ctx || !audio.enabled) return;
  const now = audioNow() + (options.delay ?? 0);
  const length = Math.max(1, Math.floor(audio.ctx.sampleRate * duration));
  const buffer = audio.ctx.createBuffer(1, length, audio.ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  const source = audio.ctx.createBufferSource();
  const filter = audio.ctx.createBiquadFilter();
  const gain = audio.ctx.createGain();
  filter.type = options.filterType ?? "bandpass";
  filter.frequency.value = options.freq ?? 900;
  filter.Q.value = options.q ?? 0.8;
  gain.gain.setValueAtTime(options.volume ?? 0.08, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.buffer = buffer;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(options.bus ?? audio.sfxGain);
  source.start(now);
}

function playSound(name) {
  if (!audio.ctx || !audio.enabled) return;
  for (const cue of AUDIO_CONFIG.sfx?.[name] ?? []) {
    if (cue.kind === "tone") playTone(cue.freq, cue.duration, cue.options ?? {});
    if (cue.kind === "noise") playNoise(cue.duration, cue.options ?? {});
  }
}

function currentMusicTheme() {
  if (state.mode === "battle" || (state.mode === "transition" && state.transition?.battleKind)) return "battle";
  if (state.scene === "mistMarsh") return "mistMarsh";
  if (state.scene === "temple") return "temple";
  if (state.scene === "mistDojo") return "mistDojo";
  return "outdoor";
}

function startSceneMusic() {
  startMusic(currentMusicTheme());
}

function startMusic(themeName) {
  if (!audio.ctx || !audio.enabled || audio.musicTheme === themeName) return;
  if (audio.musicTimer) clearInterval(audio.musicTimer);
  audio.musicTheme = themeName;
  audio.step = 0;
  const theme = MUSIC_THEMES[themeName] ?? MUSIC_THEMES.outdoor;
  const tick = () => {
    const index = theme.pattern[audio.step % theme.pattern.length] % theme.scale.length;
    const note = theme.scale[index];
    const lift = audio.step % 16 === 14 ? 2 : 1;
    const phrase = audio.step % 16;
    playTone(note * lift, themeName === "battle" ? 0.14 : 0.22, {
      volume: theme.volume,
      type: theme.tone,
      cutoff: theme.cutoff,
      bus: audio.musicGain,
    });
    if (phrase % 4 === 2) {
      playTone(note * 1.5, 0.12, {
        volume: theme.volume * 0.44,
        type: "sine",
        cutoff: theme.cutoff + 420,
        bus: audio.musicGain,
      });
    }
    if (audio.step % theme.bassEvery === 0) {
      const bassLift = phrase >= 8 ? 1.5 : 1;
      playTone(theme.drone * bassLift, themeName === "battle" ? 0.22 : 0.54, {
        volume: theme.volume * 0.82,
        type: "sine",
        cutoff: 720,
        bus: audio.musicGain,
      });
    }
    if (audio.step % theme.harmonyEvery === 0) {
      theme.harmony.forEach((offset, chordIndex) => {
        const chordNote = theme.scale[(index + offset) % theme.scale.length];
        playTone(chordNote, 0.42, {
          delay: chordIndex * 0.025,
          volume: theme.volume * 0.32,
          type: themeName === "battle" ? "triangle" : "sine",
          cutoff: theme.cutoff * 0.9,
          bus: audio.musicGain,
        });
      });
    }
    if (audio.step % 8 === 4) {
      playTone(theme.accent, 0.16, {
        volume: theme.volume * 0.58,
        type: "triangle",
        cutoff: 1800,
        bus: audio.musicGain,
      });
    }
    if (audio.step % theme.percussionEvery === 0) {
      playNoise(themeName === "battle" ? 0.045 : 0.07, {
        freq: themeName === "mistMarsh" ? 420 : 720,
        q: themeName === "battle" ? 1.4 : 0.7,
        volume: theme.volume * (themeName === "battle" ? 0.36 : 0.22),
        filterType: themeName === "mistMarsh" ? "lowpass" : "bandpass",
        bus: audio.musicGain,
      });
    }
    if (themeName === "battle" && audio.step % 4 === 1) {
      playTone(theme.drone * 2, 0.08, {
        volume: theme.volume * 0.72,
        type: "square",
        cutoff: 900,
        bus: audio.musicGain,
      });
    }
    audio.step += 1;
  };
  tick();
  audio.musicTimer = setInterval(tick, theme.tempo);
}
