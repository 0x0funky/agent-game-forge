<p align="center">
  <img src="apps/web/public/agf-banner.png" alt="Agent Game Forge" width="640" />
</p>

<p align="center">
  <b>로컬 우선, 자체 에이전트를 가져오는 2D 게임 IDE.</b><br/>
  Codex 또는 Claude Code가 운전합니다. Web은 지금, Godot과 Unity는 로드맵에.
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README.es.md">Español</a> ·
  <a href="./README.pt-BR.md">Português (Brasil)</a> ·
  <a href="./README.de.md">Deutsch</a> ·
  <a href="./README.fr.md">Français</a> ·
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="./README.zh-TW.md">繁體中文</a> ·
  <b>한국어</b> ·
  <a href="./README.ja.md">日本語</a> ·
  <a href="./README.ar.md">العربية</a> ·
  <a href="./README.ru.md">Русский</a> ·
  <a href="./README.uk.md">Українська</a> ·
  <a href="./README.tr.md">Türkçe</a>
</p>

<p align="center">
  <a href="https://github.com/0x0funky/agent-game-forge/stargazers"><img src="https://img.shields.io/github/stars/0x0funky/agent-game-forge?style=flat" alt="stars"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="license"/></a>
  <img src="https://img.shields.io/badge/status-pre--launch-blue" alt="status"/>
  <img src="https://img.shields.io/badge/node-%E2%89%A520-success" alt="node 20+"/>
</p>

<p align="center">
  🎨 스프라이트 파이프라인 제공: <a href="https://github.com/0x0funky/agent-sprite-forge"><b>agent-sprite-forge</b></a>
</p>

---

Agent Game Forge (**AGF**)는 AI 코딩 에이전트가 당신을 위해 완전한 2D 게임을 만들어 주는 오픈소스 데스크톱 IDE입니다 — 스프라이트, 패럴랙스 배경, 물리, 위험요소, 픽업, 씬 레이아웃 — 그리고 에이전트가 잘못 만든 부분을 드래그로 손볼 수 있는 비주얼 에디터를 제공합니다. **에이전트를 직접 선택**하고 (Codex CLI 또는 Claude Code), **이미지 모델을 직접 선택**합니다 (Gemini 2.5 Flash Image 또는 OpenAI gpt-image-1). 오늘 기본 출력은 바닐라 JS + Canvas입니다 (프레임워크 락인 제로, 어떤 브라우저에서도 실행); Godot 4와 Unity 엔진 타겟이 로드맵에 있습니다.

---

## ✨ 한눈에 보기

- 🤖 **자체 에이전트 사용** — Codex CLI 또는 Claude Code. Settings에서 전환. 실시간으로.
- 🎨 **프로덕션급 에셋 파이프라인** — 스프라이트 시트 크로마키, 멀티 액션 애니메이션, 4 레이어 타일 가능 패럴랙스 + 디스필 — 모두 일급으로 지원되며, 나중에 덧붙인 것이 아닙니다.
- 🖼️ **멀티 프로바이더 이미지 생성** — Gemini 2.5 Flash Image (저렴, 네이티브 멀티모달) 또는 OpenAI gpt-image-1 (프리미엄). API 키는 당신이 제공하고, 당신의 기기에 머무릅니다.
- 🧱 **비주얼 씬 에디터** — 플랫폼, 위험요소, 픽업, 콜라이더를 드래그; 히트박스 오버레이; Play 탭에 실시간 리로드.
- 📦 **로드맵의 멀티 엔진** — Web (바닐라 JS + Canvas)이 오늘 출시되며 프레임워크 락인 제로 (GitHub Pages에 푸시하면 그대로 동작). Godot 4와 Unity 타겟이 계획되어 있습니다.
- 💻 **로컬 우선, 오픈소스** — 데몬 + 웹 UI는 `localhost`에서; 프로젝트 파일은 당신의 디스크에 머무름; MIT 스타일 의도.
- 💰 **비용 투명성** — Settings 패널이 오늘의 이미지 생성 호출 수와 프로바이더별 예상 $ 지출을 표시합니다.

---

## 🎬 데모

**히어로 샷** — AGF 창:

<p align="center">
  <img src="apps/web/public/hero-shot.png" alt="AGF main window" width="800" />
</p>

**Settings** — 에이전트 + API 키 + 이미지 생성 기본값 선택:

<p align="center">
  <img src="apps/web/public/setting.png" alt="AGF Settings modal" width="800" />
</p>

**씬 에디터** — 플랫폼, 위험요소, 픽업, 콜라이더 드래그:

<p align="center">
  <img src="apps/web/public/scene-editor.png" alt="AGF Scene editor" width="800" />
</p>

---

## 🚀 빠른 시작

**요구사항**: Node ≥ 20, npm ≥ 10, 그리고 **다음 중 최소 하나**:

- [Codex CLI](https://github.com/openai/codex) — `npm i -g @openai/codex`
- [Claude Code](https://github.com/anthropics/claude-code) — `npm i -g @anthropic-ai/claude-code`

```bash
git clone https://github.com/0x0funky/agent-game-forge.git
cd agent-game-forge
npm install
npm run dev
```

다음이 실행됩니다:

- **Daemon**은 <http://localhost:7621>
- **Web UI**는 <http://localhost:7620>

웹 URL을 엽니다. 오른쪽 상단의 톱니바퀴 아이콘을 클릭 → **Settings**:

1. **Agent CLI** — Codex 또는 Claude Code 선택 (설치한 것).
2. **API keys** (Claude Code 경로에서만 필요) — Gemini 또는 OpenAI 키를 붙여넣습니다. 데몬이 `~/.ogf/secrets.json` (mode 600)에 기록합니다. 환경 변수 (`OPENAI_API_KEY`, `GEMINI_API_KEY`)가 파일을 덮어씁니다.
3. **Image-gen defaults** — 선호하는 프로바이더 + 모델 선택.

Settings를 닫습니다. 프로젝트 폴더를 엽니다. 다음과 같은 프롬프트를 입력합니다:

> *"옥상과 공원 정문 레벨이 있는, 집으로 가는 강아지에 관한 사이드 스크롤 플랫포머."*

전송을 누릅니다. 에이전트가 만드는 것을 지켜봅니다. 멈추면 **Play**를 누릅니다.

---

## 🧭 작동 방식

```
        ┌──────────────┐    ┌──────────────────────────┐    ┌─────────────┐
You ─→  │  Web UI      │ ←→ │  Daemon (Node + SQLite)  │ ←→ │  Agent CLI  │
        │  React canvas│    │  /api/runs, /api/scenes  │    │  (Codex /   │
        │  Scene editor│    │  /api/gen-image (routed) │    │   Claude    │
        └──────────────┘    └──────────────┬───────────┘    │   Code)     │
                                           │                 └─────┬───────┘
                                           ↓                       │
                                    ┌──────┴──────┐                │
                                    │ Gemini /    │ ←──────────────┘
                                    │ OpenAI API  │   (image gen via
                                    │ (your key)  │    daemon HTTP)
                                    └─────────────┘
```

**1. 채팅에서 에이전트와 대화합니다.** 웹 UI가 대화를 스트리밍합니다; SSE가 모든 토큰 + 도구 호출을 중계합니다.

**2. 에이전트는 AGF 컨벤션과 스킬을 읽습니다.** 각 프로젝트에는 `.ogf/conventions/` (보편 + 장르별 규칙)와 `.agents/skills/` (스프라이트 + 맵 생성 절차)가 벤더링되어 있습니다. 에이전트는 레시피를 따르고, 파이프라인을 재발명하지 않습니다.

**3. 이미지의 경우, 에이전트가 데몬의 `/api/gen-image`를 호출합니다** (`python .agents/tools/gen-image.py` 또는 직접 `curl`을 통해). 데몬은 저장된 API 키를 사용해 Gemini 또는 OpenAI로 라우팅합니다. 내장 `image_gen` 도구를 가진 Codex 사용자는 그것을 대신 사용할 수 있으며 — 두 경로 모두 동등한 PNG를 생성합니다.

**4. 씬 에디터는 에이전트가 만든 동일한 JSON 파일을 읽고 씁니다.** 플랫폼을 드래그하면 에디터가 JSON 패치를 커밋합니다. 에이전트의 뷰를 새로고침하면 업데이트가 보입니다.

**5. 런타임은 프로젝트 자체입니다.** 생성된 게임은 순수 JS + Canvas입니다 — `index.html`, `src/*.js`, `data/*.json`, `assets/`. 폴더를 GitHub Pages에 푸시하세요. 끝.

---

## 📂 저장소 구조

```
open-game-forge/
├── packages/
│   └── contracts/      # 공유 TypeScript 타입: API, events, SceneModel
├── apps/
│   ├── daemon/         # Node.js + Express 데몬 (port 7621)
│   │   └── src/
│   │       ├── server.ts            # HTTP routes
│   │       ├── codex.ts             # Codex CLI adapter (spawn + stream-json)
│   │       ├── claude-code.ts       # Claude Code adapter (동일 패턴)
│   │       ├── agents.ts            # AgentAdapter dispatcher
│   │       ├── gen-image.ts         # Gemini + OpenAI router
│   │       ├── secrets.ts           # ~/.ogf/secrets.json 저장소
│   │       ├── prefs.ts             # ~/.ogf/preferences.json 저장소
│   │       ├── web-scene.ts         # JSON level → SceneModel 로더
│   │       ├── scenes.ts            # SceneOp applier (move/scale/add/remove)
│   │       └── templates/           # 벤더링된 skills / conventions / recipes
│   └── web/            # Vite + React UI (port 7620)
│       └── src/
│           ├── App.tsx
│           ├── components/
│           │   ├── SceneEditor.tsx  # Canvas 기반 씬 에디터
│           │   ├── SettingsModal.tsx
│           │   └── PlayPane.tsx
│           └── lib/api.ts
└── docs/
    ├── architecture.md
    ├── roadmap.md
    └── genre-support.md
```

---

## 🛠️ 소스에서 빌드

```bash
npm install           # workspace 설치
npm run build         # build contracts → daemon → web
npm run dev           # 세 가지 모두 watch 모드 (데몬은 tsx로 핫 리로드)
```

유용한 명령어:

- `npm -w @ogf/daemon run dev` — 데몬만, `tsx watch`로
- `npm -w @ogf/web run dev` — Vite 개발 서버
- `npm -w @ogf/contracts run build` — contracts 패키지 타입 체크

---

## 📋 프로젝트 상태

| 장르 | 상태 | 비고 |
|---|---|---|
| **사이드 스크롤 플랫포머** | ✅ 출시됨 | 패럴랙스 파이프라인, 위험요소, 픽업, 적, 멀티 레벨, 스프라이트 크로마키 |
| 탑다운 RPG | 🟡 부분적 | Foundation seed + 레시피; 일부 레시피는 아직 성숙 중 |
| 타워 디펜스 / 아레나 | 🟡 부분적 | 이전 브랜치에서 상속; 다듬기 필요 |
| 로그라이크 / 메트로배니아 | 🟡 부분적 | 출시 이후 |

**엔진 타겟**:

| 엔진 | 상태 | 비고 |
|---|---|---|
| **Web** (바닐라 JS + Canvas) | ✅ 기본 | 활발히 개발 중. 프레임워크 의존성 제로; GitHub Pages에 푸시하면 그대로 동작. |
| **Godot 4** | 🟡 레거시 + 로드맵 | 기존 Godot 프로젝트는 여전히 로드 + 편집 가능. 출시 후 로드맵에서 일급 지원으로 재투자 예정. |
| **Unity** | 🚧 계획됨 | Godot 일급 지원이 안착한 이후를 목표로 함. |

---

## 📚 문서

- [`docs/architecture.md`](docs/architecture.md) — 설계 원칙, 에이전트 우선 패러다임
- [`docs/roadmap.md`](docs/roadmap.md) — 단계별 계획
- [`docs/genre-support.md`](docs/genre-support.md) — 장르 매트릭스
- 컨벤션 파일 (프로젝트별 벤더링) — [`apps/daemon/src/templates/conventions/`](apps/daemon/src/templates/conventions)
- 레시피 (프로젝트별 벤더링) — [`apps/daemon/src/templates/recipes/`](apps/daemon/src/templates/recipes)

---

## 🤝 기여

저희는 출시 전 단계입니다. 코드베이스가 PR을 환영할 만큼 작지만, 범위를 논의하기 위해 먼저 이슈를 열어 주세요. 지금 도울 수 있는 가장 좋은 방법:

- **사용해보고 버그 보고** — 데몬 로그와 함께 이슈를 엽니다 (`~/.ogf/claude-code-debug.jsonl` 또는 `npm run dev`를 실행하는 셸 터미널)
- **게임을 만들어** 보여주세요 — README에 기꺼이 소개합니다
- **macOS / Linux에서 테스트** — 주 개발은 Windows에서 진행되므로, 크로스 플랫폼 이슈가 잠재해 있을 가능성이 큽니다

---

## 🔐 보안 및 데이터

- **당신의 코드는 당신의 기기에 머무릅니다.** AGF는 로컬 우선입니다. 데몬은 `127.0.0.1`에 바인딩됩니다; 당신이 선택한 AI 프로바이더로의 호출을 제외하고는 아무것도 기기를 떠나지 않습니다.
- **API 키**는 `~/.ogf/secrets.json`에 file mode 600 (소유자 전용)으로 저장됩니다. 절대 git에 들어가지 않고, AGF의 로그에도 나타나지 않습니다.
- **대화**는 `~/.ogf/ogf.db` (SQLite)에 저장됩니다. 리셋하려면 파일을 삭제하세요.

---

## 📜 라이선스

[Apache License, Version 2.0](LICENSE) 하에 라이선스됩니다. 자유롭게 사용, 수정, 포크, 배포할 수 있습니다 — 상업적 사용 포함. copyright 및 license 고지만 유지해 주세요.

---

## 🙏 크레딧

- 데몬 앤 스폰 패턴은 [`nexu-io/open-design`](https://github.com/nexu-io/open-design)에서 적용
- 스프라이트 생성 파이프라인은 [`0x0funky/agent-sprite-forge`](https://github.com/0x0funky/agent-sprite-forge)에서 적용
- Codex CLI + Claude Code로 제작 — 그렇습니다, 이 프로젝트는 그것이 운전하는 동일한 에이전트들이 대부분 작성했습니다

---

<p align="center">
  출시를 좋아하는 인디 게임 개발자들을 위해 만들어졌습니다.<br/>
  <a href="https://github.com/0x0funky/agent-game-forge/issues">버그 신고</a> ·
  <a href="https://github.com/0x0funky/agent-game-forge/discussions">Discussions</a>
</p>
