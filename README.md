# Open Game Forge

Agent-native 2D game editor. Cursor-like workspace where the left pane is a game editor (sprites, maps, scenes) and the right pane is a coding agent (Codex CLI). Drives Godot, Unity, and WebGL projects.

## Status

v0.0.1 — scaffold. Daemon detects Codex on PATH and streams JSONL events over SSE. Web UI is a minimal two-pane chat to verify the pipe.

## Quick start

Requires Node 20+, npm 10+, and `codex` CLI installed (`npm i -g @openai/codex`).

```bash
npm install
npm run dev
```

This starts:

- Daemon: <http://localhost:7621>
- Web:    <http://localhost:7620>

Open the web URL. The agent pill should turn green if Codex is detected. Type a prompt and you should see streaming events.

## Layout

```
open-game-forge/
├── packages/contracts/   # shared API / SSE types
├── apps/daemon/          # Node.js + Express, spawns Codex
└── apps/web/             # Vite + React UI
```

## Architecture

See `C:\Users\User\.termhive\shared_content\GameMaker\open_game_forge_skill_status_research.md` for product reasoning and `open_game_forge_ui_spec.md` for UI direction.

The daemon-and-spawn pattern is adapted from [`nexu-io/open-design`](https://github.com/nexu-io/open-design).
