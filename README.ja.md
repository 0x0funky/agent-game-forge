<p align="center">
  <img src="apps/web/public/agf-banner.png" alt="Agent Game Forge" width="640" />
</p>

<p align="center">
  <b>ローカルファースト・好きな AI agent で動かす 2D ゲーム IDE。</b><br/>
  Codex または Claude Code が書く。Web は今日から、Godot と Unity はロードマップに。
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README.es.md">Español</a> ·
  <a href="./README.pt-BR.md">Português (Brasil)</a> ·
  <a href="./README.de.md">Deutsch</a> ·
  <a href="./README.fr.md">Français</a> ·
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="./README.zh-TW.md">繁體中文</a> ·
  <a href="./README.ko.md">한국어</a> ·
  <b>日本語</b> ·
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
  🎨 スプライトパイプライン提供: <a href="https://github.com/0x0funky/agent-sprite-forge"><b>agent-sprite-forge</b></a>
</p>

---

Agent Game Forge(**AGF**)は、AI コーディングエージェントに完全な 2D ゲームを作らせるオープンソースのデスクトップ IDE です — スプライト、パララックス背景、物理演算、ハザード、ピックアップ、シーン配置まで — そして agent がうまく作れなかった部分は、ビジュアルエディタでドラッグして調整できます。**agent を選び**(Codex CLI または Claude Code)、**画像生成モデルを選び**(Gemini 2.5 Flash Image または OpenAI gpt-image-1)。今日のデフォルト出力は vanilla JS + Canvas(フレームワークロックインなし、どのブラウザでも動く); Godot 4 と Unity エンジンターゲットはロードマップ上にあります。

---

## ✨ 特徴

- 🤖 **好きな agent を持ち込む** — Codex CLI または Claude Code。Settings でライブ切り替え。
- 🎨 **本格的なアセットパイプライン** — スプライトシートのクロマキー、マルチアクションアニメーション、4 層 tileable パララックス + despill — すべて一級市民、後付けではない。
- 🖼️ **マルチプロバイダー画像生成** — Gemini 2.5 Flash Image(安価・ネイティブマルチモーダル)または OpenAI gpt-image-1(プレミアム)。API キーはあなたが持ち込み、ローカルに留まる。
- 🧱 **ビジュアルシーンエディタ** — プラットフォーム、ハザード、ピックアップ、コライダーをドラッグ; hitbox オーバーレイ; Play タブへのライブリロード。
- 📦 **ロードマップ上のマルチエンジン** — Web(vanilla JS + Canvas)が今日出荷、フレームワークロックインなし(GitHub Pages に push すればそのまま動く)。Godot 4 と Unity ターゲットを計画中。
- 💻 **ローカルファースト、オープンソース** — daemon + Web UI は `localhost` で動作; プロジェクトファイルはディスクに留まる; MIT 志向。
- 💰 **コスト透明** — Settings パネルが本日の画像生成呼び出し数と推定 $ 費用をプロバイダー別に表示。

---

## 🎬 デモ

**ヒーロー画像** — AGF ウィンドウ:

<p align="center">
  <img src="apps/web/public/hero-shot.png" alt="AGF main window" width="800" />
</p>

**Settings** — agent + API キー + image-gen デフォルトを選択:

<p align="center">
  <img src="apps/web/public/setting.png" alt="AGF Settings modal" width="800" />
</p>

**Scene editor** — プラットフォーム、ハザード、ピックアップ、コライダーをドラッグ:

<p align="center">
  <img src="apps/web/public/scene-editor.png" alt="AGF Scene editor" width="800" />
</p>

---

## 🚀 クイックスタート

**要件**: Node ≥ 20、npm ≥ 10、以下の **少なくとも 1 つ**の agent CLI:

- [Codex CLI](https://github.com/openai/codex) — `npm i -g @openai/codex`
- [Claude Code](https://github.com/anthropics/claude-code) — `npm i -g @anthropic-ai/claude-code`

```bash
git clone https://github.com/0x0funky/agent-game-forge.git
cd agent-game-forge
npm install
npm run dev
```

起動するもの:

- **Daemon** — <http://localhost:7621>
- **Web UI** — <http://localhost:7620>

Web URL を開いて、右上の歯車アイコン → **Settings**:

1. **Agent CLI** — Codex または Claude Code を選択(インストール済みの方)。
2. **API キー**(Claude Code パスのみ必要)— Gemini または OpenAI のキーを貼り付け。Daemon が `~/.ogf/secrets.json` に書き込む(mode 600)。環境変数(`OPENAI_API_KEY`、`GEMINI_API_KEY`)はファイルより優先。
3. **Image-gen デフォルト** — 優先プロバイダー + モデルを選択。

Settings を閉じてプロジェクトフォルダを開き、こんなプロンプトを入力:

> *「家に帰る犬の横スクロールプラットフォーマー、屋上ルートと公園ゲートのステージで。」*

送信。agent が組み立てるのを見て、止まったら **Play** を押す。

---

## 🧭 仕組み

```
        ┌──────────────┐    ┌──────────────────────────┐    ┌─────────────┐
あなた─→│  Web UI      │ ←→ │  Daemon (Node + SQLite)  │ ←→ │  Agent CLI  │
        │  React canvas│    │  /api/runs, /api/scenes  │    │  (Codex /   │
        │  Scene editor│    │  /api/gen-image (ルータ)  │    │   Claude    │
        └──────────────┘    └──────────────┬───────────┘    │   Code)     │
                                           │                 └─────┬───────┘
                                           ↓                       │
                                    ┌──────┴──────┐                │
                                    │ Gemini /    │ ←──────────────┘
                                    │ OpenAI API  │  (画像生成は
                                    │ (あなたのキー)│   daemon HTTP 経由)
                                    └─────────────┘
```

**1. agent とチャットで対話**。Web UI が SSE でトークンとツール呼び出しをストリーミング。

**2. agent は AGF の conventions と skills を読む**。各プロジェクトに `.ogf/conventions/`(共通 + ジャンル別ルール)と `.agents/skills/`(sprite + map 生成手順)が vendor 配置される。Agent はレシピに従い、パイプラインを再発明しない。

**3. 画像は daemon の `/api/gen-image` を呼ぶ**(`python .agents/tools/gen-image.py` または直接 `curl` で)。Daemon があなたの API キーで Gemini または OpenAI にルーティング。Codex の組み込み `image_gen` も使える — 両経路とも同等の PNG を出力。

**4. Scene editor と agent は同じ JSON ファイルを読み書き**。プラットフォームをドラッグ → editor が JSON patch を commit; agent が次に見たときには反映済み。

**5. ランタイムはプロジェクトそのもの**。生成されたゲームは純 JS + Canvas — `index.html`、`src/*.js`、`data/*.json`、`assets/`。GitHub Pages に push すれば動く。

---

## 📂 リポジトリ構成

```
open-game-forge/
├── packages/
│   └── contracts/      # 共有 TypeScript 型: API、events、SceneModel
├── apps/
│   ├── daemon/         # Node.js + Express daemon(port 7621)
│   │   └── src/
│   │       ├── server.ts            # HTTP routes
│   │       ├── codex.ts             # Codex CLI adapter
│   │       ├── claude-code.ts       # Claude Code adapter
│   │       ├── agents.ts            # AgentAdapter dispatcher
│   │       ├── gen-image.ts         # Gemini + OpenAI ルータ
│   │       ├── secrets.ts           # ~/.ogf/secrets.json
│   │       ├── prefs.ts             # ~/.ogf/preferences.json
│   │       ├── web-scene.ts         # JSON level → SceneModel ローダー
│   │       ├── scenes.ts            # SceneOp applier
│   │       └── templates/           # 内蔵 skills / conventions / recipes
│   └── web/            # Vite + React UI(port 7620)
│       └── src/
│           ├── App.tsx
│           ├── components/
│           │   ├── SceneEditor.tsx  # Canvas シーンエディタ
│           │   ├── SettingsModal.tsx
│           │   └── PlayPane.tsx
│           └── lib/api.ts
└── docs/
    ├── architecture.md
    ├── roadmap.md
    └── genre-support.md
```

---

## 🛠️ ソースからビルド

```bash
npm install           # workspace インストール
npm run build         # contracts → daemon → web の順にビルド
npm run dev           # 3 つすべて watch モード(daemon は tsx で hot-reload)
```

便利なコマンド:

- `npm -w @ogf/daemon run dev` — daemon のみ
- `npm -w @ogf/web run dev` — Vite dev サーバー
- `npm -w @ogf/contracts run build` — contracts パッケージの型チェック

---

## 📋 プロジェクトステータス

| ジャンル | ステータス | 備考 |
|---|---|---|
| **横スクロールプラットフォーマー** | ✅ ship 済み | Parallax pipeline、ハザード、ピックアップ、敵、マルチレベル、sprite chroma-key |
| 見下ろし RPG | 🟡 部分的 | Foundation seed + recipes あり; 一部の recipe は調整中 |
| Tower defense / アリーナ | 🟡 部分的 | 旧ブランチから継承; polish が必要 |
| Roguelike / Metroidvania | 🟡 部分的 | Launch 後 |

**エンジンターゲット**:

| エンジン | ステータス | 備考 |
|---|---|---|
| **Web**(vanilla JS + Canvas) | ✅ デフォルト | 活発に開発中。フレームワーク依存ゼロ; GitHub Pages に push すればそのまま動く。 |
| **Godot 4** | 🟡 レガシー + ロードマップ | 既存の Godot プロジェクトは引き続き読み込み + 編集可能。launch 後のロードマップで一級サポートとして再投資予定。 |
| **Unity** | 🚧 計画中 | Godot の一級サポートが安定した後を予定。 |

---

## 📚 ドキュメント

- [`docs/architecture.md`](docs/architecture.md) — 設計原則、agent-first パラダイム
- [`docs/roadmap.md`](docs/roadmap.md) — フェーズド計画
- [`docs/genre-support.md`](docs/genre-support.md) — ジャンルサポート行列
- Convention ファイル(プロジェクトごとに vendor)— [`apps/daemon/src/templates/conventions/`](apps/daemon/src/templates/conventions)
- Recipe ファイル — [`apps/daemon/src/templates/recipes/`](apps/daemon/src/templates/recipes)

---

## 🤝 コントリビュート

Pre-launch 段階です。コードベースは小さく、PR は歓迎ですが、**まず issue を立ててスコープを相談**してください。今もっとも助かるのは:

- **試してバグ報告** — daemon ログ(`~/.ogf/claude-code-debug.jsonl` または `npm run dev` のターミナル)を添えて issue を
- **ゲームを作って見せる** — README に featured として載せます
- **macOS / Linux テスト** — メイン開発は Windows、クロスプラットフォームの問題は確実にある

---

## 🔐 セキュリティとデータ

- **コードはあなたのマシンに留まる**。AGF はローカルファースト。Daemon は `127.0.0.1` にバインド; 選んだ AI プロバイダーへの呼び出し以外、マシンから出ない。
- **API キー** は `~/.ogf/secrets.json` に file mode 600(オーナーのみ読める)で保存。git には絶対入らず、AGF のログにも現れない。
- **会話履歴** は `~/.ogf/ogf.db`(SQLite)。リセットしたければファイルを削除。

---

## 📜 ライセンス

[Apache License, Version 2.0](LICENSE) の下でライセンスされています。商用・非商用問わず、自由に使用・改変・フォーク・配布できます。copyright とライセンス表示だけ残してください。

---

## 🙏 クレジット

- Daemon-and-spawn パターンは [`nexu-io/open-design`](https://github.com/nexu-io/open-design) を参考
- スプライト生成パイプラインは [`0x0funky/agent-sprite-forge`](https://github.com/0x0funky/agent-sprite-forge) から派生
- Codex CLI + Claude Code で構築 — そう、このプロジェクトの大部分は自分が駆動する agent によって書かれています

---

<p align="center">
  Ship するのが好きな indie ゲーム開発者へ。<br/>
  <a href="https://github.com/0x0funky/agent-game-forge/issues">バグ報告</a> ·
  <a href="https://github.com/0x0funky/agent-game-forge/discussions">ディスカッション</a>
</p>
