<p align="center">
  <img src="apps/web/public/agf-banner.png" alt="Agent Game Forge" width="640" />
</p>

<p align="center">
  <b>Local-first, bring-your-own-agent 2D oyun IDE'si.</b><br/>
  Direksiyonda Codex veya Claude Code. Bugün Web, yol haritasında Godot ve Unity.
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
  <a href="./README.ja.md">日本語</a> ·
  <a href="./README.ar.md">العربية</a> ·
  <a href="./README.ru.md">Русский</a> ·
  <a href="./README.uk.md">Українська</a> ·
  <b>Türkçe</b>
</p>

<p align="center">
  <a href="https://github.com/0x0funky/agent-game-forge/stargazers"><img src="https://img.shields.io/github/stars/0x0funky/agent-game-forge?style=flat" alt="stars"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="license"/></a>
  <img src="https://img.shields.io/badge/status-pre--launch-blue" alt="status"/>
  <img src="https://img.shields.io/badge/node-%E2%89%A520-success" alt="node 20+"/>
</p>

<p align="center">
  🎨 Sprite pipeline'ı <a href="https://github.com/0x0funky/agent-sprite-forge"><b>agent-sprite-forge</b></a> tarafından
</p>

---

Agent Game Forge (**AGF**), bir AI kodlama agent'ının senin için eksiksiz 2D oyunlar inşa etmesine olanak tanıyan açık kaynaklı bir masaüstü IDE'sidir — sprite'lar, parallax arka planlar, fizik, tehlikeler, toplanabilirler, sahne düzenleri — ve agent'ın yanlış yaptıklarını sürükle-bırak ile ince ayar yapabilmen için görsel bir editör sunar. **Agent'ı sen seçersin** (Codex CLI veya Claude Code) ve **görsel modelini sen seçersin** (Gemini 2.5 Flash Image veya OpenAI gpt-image-1). Bugün varsayılan çıktı vanilla JS + Canvas (sıfır framework kilitlemesi, herhangi bir tarayıcıda çalışır); Godot 4 ve Unity motor hedefleri ise yol haritasında.

---

## ✨ Bir bakışta

- 🤖 **Kendi agent'ını getir** — Codex CLI veya Claude Code. Settings'ten değiştir. Canlı olarak.
- 🎨 **Üretim kalitesinde asset pipeline'ı** — sprite-sheet chroma-key, çok-aksiyonlu animasyon, 4 katmanlı tileable parallax + despill — hepsi birinci sınıf, sonradan eklenmiş değil.
- 🖼️ **Çoklu sağlayıcılı görsel üretimi** — Gemini 2.5 Flash Image (ucuz, doğal multimodal) veya OpenAI gpt-image-1 (premium). API anahtarını sen sağlarsın; makinende kalır.
- 🧱 **Görsel sahne editörü** — platformları, tehlikeleri, toplanabilirleri, collider'ları sürükle; hitbox overlay'i; Play sekmesine canlı yeniden yükleme.
- 📦 **Yol haritasında çoklu motor** — Web (vanilla JS + Canvas) bugün sıfır framework kilitlemesiyle çıkıyor (klasörü GitHub Pages'e yükle, çalışır). Godot 4 ve Unity hedefleri planlanıyor.
- 💻 **Local-first, açık kaynak** — daemon + web UI `localhost` üzerinde; proje dosyaların diskinde kalır; MIT tarzı niyet.
- 💰 **Maliyet şeffaflığı** — Settings paneli bugünkü görsel üretim çağrı sayısını ve sağlayıcı başına tahmini $ harcamayı gösterir.

---

## 🎬 Demo

**Hero shot** — AGF penceresi:

<p align="center">
  <img src="apps/web/public/hero-shot.png" alt="AGF ana penceresi" width="800" />
</p>

**Settings** — agent'ını + API anahtarlarını + görsel üretim varsayılanlarını seç:

<p align="center">
  <img src="apps/web/public/setting.png" alt="AGF Settings modalı" width="800" />
</p>

**Sahne editörü** — platformları, tehlikeleri, toplanabilirleri, collider'ları sürükle:

<p align="center">
  <img src="apps/web/public/scene-editor.png" alt="AGF Sahne editörü" width="800" />
</p>

---

## 🚀 Hızlı başlangıç

**Gereksinimler**: Node ≥ 20, npm ≥ 10 ve **en az biri**:

- [Codex CLI](https://github.com/openai/codex) — `npm i -g @openai/codex`
- [Claude Code](https://github.com/anthropics/claude-code) — `npm i -g @anthropic-ai/claude-code`

```bash
git clone https://github.com/0x0funky/agent-game-forge.git
cd agent-game-forge
npm install
npm run dev
```

Bu şunları başlatır:

- **Daemon** <http://localhost:7621> adresinde
- **Web UI** <http://localhost:7620> adresinde

Web URL'ini aç. Dişli simgesine tıkla (sağ üst) → **Settings**:

1. **Agent CLI** — Codex veya Claude Code'u seç (hangisini yüklediysen).
2. **API keys** (yalnızca Claude Code yolu için gerekir) — Gemini veya OpenAI anahtarını yapıştır. Daemon bunları `~/.ogf/secrets.json` dosyasına yazar (mode 600). Ortam değişkenleri (`OPENAI_API_KEY`, `GEMINI_API_KEY`) dosyayı geçersiz kılar.
3. **Image-gen defaults** — tercih ettiğin sağlayıcı + modeli seç.

Settings'i kapat. Bir proje klasörü aç. Şuna benzer bir prompt yaz:

> *"Çatı ve park kapısı seviyelerini içeren, eve dönen bir köpek hakkında side-scroll platformer."*

Gönder'e bas. Agent'ın inşa edişini izle. Durduğunda **Play**'e bas.

---

## 🧭 Nasıl çalışır

```
        ┌──────────────┐    ┌──────────────────────────┐    ┌─────────────┐
Sen ─→  │  Web UI      │ ←→ │  Daemon (Node + SQLite)  │ ←→ │  Agent CLI  │
        │  React canvas│    │  /api/runs, /api/scenes  │    │  (Codex /   │
        │  Scene editor│    │  /api/gen-image (routed) │    │   Claude    │
        └──────────────┘    └──────────────┬───────────┘    │   Code)     │
                                           │                 └─────┬───────┘
                                           ↓                       │
                                    ┌──────┴──────┐                │
                                    │ Gemini /    │ ←──────────────┘
                                    │ OpenAI API  │   (daemon HTTP üzerinden
                                    │ (senin key) │    görsel üretimi)
                                    └─────────────┘
```

**1. Agent ile sohbette konuşursun.** Web UI sohbeti stream'ler; SSE her token + tool çağrısını ileri taşır.

**2. Agent AGF conventions ve skills'lerini okur.** Her projeye `.ogf/conventions/` (evrensel + tür bazlı kurallar) ve `.agents/skills/` (sprite + map üretim prosedürleri) vendor edilir. Agent recipes'lere uyar — pipeline'ı yeniden icat etmez.

**3. Görseller için agent daemon'un `/api/gen-image` endpoint'ini çağırır** (`python .agents/tools/gen-image.py` veya doğrudan `curl` aracılığıyla). Daemon, kaydettiğin API anahtarını kullanarak Gemini veya OpenAI'ye yönlendirir. Yerleşik `image_gen` aracına sahip Codex kullanıcıları bunun yerine onu kullanabilir — her iki yol da eşdeğer PNG'ler üretir.

**4. Sahne editörü, agent'ın oluşturduğu aynı JSON dosyalarını okur + yazar.** Bir platform sürükle; editör JSON patch'ini commit'ler. Agent'ın görünümünü yenile; güncellemeyi görür.

**5. Runtime, projenin kendisidir.** Üretilen oyunlar saf JS + Canvas'tır — `index.html`, `src/*.js`, `data/*.json`, `assets/`. Klasörü GitHub Pages'e yükle. Bitti.

---

## 📂 Repo düzeni

```
open-game-forge/
├── packages/
│   └── contracts/      # paylaşılan TypeScript tipleri: API, events, SceneModel
├── apps/
│   ├── daemon/         # Node.js + Express daemon (port 7621)
│   │   └── src/
│   │       ├── server.ts            # HTTP routes
│   │       ├── codex.ts             # Codex CLI adapter (spawn + stream-json)
│   │       ├── claude-code.ts       # Claude Code adapter (aynı pattern)
│   │       ├── agents.ts            # AgentAdapter dispatcher
│   │       ├── gen-image.ts         # Gemini + OpenAI router
│   │       ├── secrets.ts           # ~/.ogf/secrets.json deposu
│   │       ├── prefs.ts             # ~/.ogf/preferences.json deposu
│   │       ├── web-scene.ts         # JSON level → SceneModel loader
│   │       ├── scenes.ts            # SceneOp applier (move/scale/add/remove)
│   │       └── templates/           # vendor edilmiş skills / conventions / recipes
│   └── web/            # Vite + React UI (port 7620)
│       └── src/
│           ├── App.tsx
│           ├── components/
│           │   ├── SceneEditor.tsx  # Canvas tabanlı sahne editörü
│           │   ├── SettingsModal.tsx
│           │   └── PlayPane.tsx
│           └── lib/api.ts
└── docs/
    ├── architecture.md
    ├── roadmap.md
    └── genre-support.md
```

---

## 🛠️ Kaynaktan derleme

```bash
npm install           # workspace kurulumu
npm run build         # build contracts → daemon → web
npm run dev           # üçü için watch modu (daemon tsx üzerinden hot-reload)
```

Faydalı komutlar:

- `npm -w @ogf/daemon run dev` — yalnızca daemon, `tsx watch` ile
- `npm -w @ogf/web run dev` — Vite dev sunucusu
- `npm -w @ogf/contracts run build` — contracts paketinin type-check'i

---

## 📋 Proje durumu

| Tür | Durum | Notlar |
|---|---|---|
| **Side-scroll platformer** | ✅ yayınlandı | Parallax pipeline, tehlikeler, toplanabilirler, düşmanlar, çok-seviye, sprite chroma-key |
| Top-down RPG | 🟡 kısmen | Foundation seed + recipes; bazı recipes hâlâ olgunlaşıyor |
| Tower defense / arena | 🟡 kısmen | Önceki branch'lerden devralındı; cila gerekiyor |
| Roguelike / Metroidvania | 🟡 kısmen | Launch sonrası |

**Motor hedefleri**:

| Motor | Durum | Notlar |
|---|---|---|
| **Web** (vanilla JS + Canvas) | ✅ varsayılan | Aktif olarak geliştiriliyor. Sıfır framework bağımlılığı; klasörü GitHub Pages'e yükle, çalışır. |
| **Godot 4** | 🟡 legacy + yol haritası | Mevcut Godot projeleri hâlâ yüklenip düzenlenebiliyor. Birinci sınıf yeniden yatırım, launch sonrası yol haritasında. |
| **Unity** | 🚧 planlandı | Godot birinci sınıfa ulaştıktan sonra hedeflenecek. |

---

## 📚 Dokümantasyon

- [`docs/architecture.md`](docs/architecture.md) — tasarım ilkeleri, agent-first paradigma
- [`docs/roadmap.md`](docs/roadmap.md) — aşamalı plan
- [`docs/genre-support.md`](docs/genre-support.md) — tür matrisi
- Convention dosyaları (proje bazlı vendor edilmiş) — [`apps/daemon/src/templates/conventions/`](apps/daemon/src/templates/conventions)
- Recipes (proje bazlı vendor edilmiş) — [`apps/daemon/src/templates/recipes/`](apps/daemon/src/templates/recipes)

---

## 🤝 Katkıda bulunma

Pre-launch aşamasındayız. Kod tabanı PR kabul edebilecek kadar küçük, ancak lütfen kapsamı tartışmak için önce bir issue açın. Şu anda yardım etmenin en iyi yolları:

- **Dene ve hataları bildir** — daemon log'u (`~/.ogf/claude-code-debug.jsonl` veya `npm run dev` çalıştırdığın shell terminal'in) ile bir issue aç
- **Bir oyun inşa et** ve bize göster — README'de öne çıkarmaktan mutluluk duyarız
- **macOS / Linux'ta test et** — birincil geliştirme Windows'ta; çapraz platform sorunları muhtemelen pusudadır

---

## 🔐 Güvenlik ve veri

- **Kodun makinende kalır.** AGF local-first'tür. Daemon `127.0.0.1`'e bind olur; seçtiğin AI sağlayıcısına yapılan çağrılar dışında hiçbir şey makinenden çıkmaz.
- **API anahtarları** `~/.ogf/secrets.json` dosyasında file mode 600 (yalnızca sahip) ile saklanır. Asla git'e girmez, asla AGF log'larında görünmez.
- **Konuşmalar** `~/.ogf/ogf.db` (SQLite) içinde saklanır. Sıfırlamak için dosyayı sil.

---

## 📜 Lisans

[Apache License, Version 2.0](LICENSE) altında lisanslanmıştır. Özgürce kullanabilir, değiştirebilir, fork'layabilir ve yayınlayabilirsiniz — ticari ya da değil. Sadece copyright ve lisans bildirimini koruyun.

---

## 🙏 Teşekkürler

- Daemon-and-spawn pattern'i [`nexu-io/open-design`](https://github.com/nexu-io/open-design) projesinden uyarlanmıştır
- Sprite üretim pipeline'ı [`0x0funky/agent-sprite-forge`](https://github.com/0x0funky/agent-sprite-forge) projesinden uyarlanmıştır
- Codex CLI + Claude Code ile inşa edildi — evet, bu proje büyük ölçüde sürdüğü agent'lar tarafından yazıldı

---

<p align="center">
  Ürün çıkarmayı seven indie oyun geliştiricileri için yapıldı.<br/>
  <a href="https://github.com/0x0funky/agent-game-forge/issues">Bug bildir</a> ·
  <a href="https://github.com/0x0funky/agent-game-forge/discussions">Discussions</a>
</p>
