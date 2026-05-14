<p align="center">
  <img src="apps/web/public/agf-banner.png" alt="Agent Game Forge" width="640" />
</p>

<p align="center">
  <b>بيئة تطوير ألعاب ثنائية الأبعاد محلية أولاً، أحضِر وكيلك الخاص.</b><br/>
  Codex أو Claude Code هو القائد. Web اليوم، وGodot وUnity على خارطة الطريق.
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
  <b>العربية</b> ·
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
  🎨 خط أنابيب السبرايت من <a href="https://github.com/0x0funky/agent-sprite-forge"><b>agent-sprite-forge</b></a>
</p>

---

Agent Game Forge (**AGF**) هو بيئة تطوير متكاملة لسطح المكتب مفتوحة المصدر تتيح لوكيل برمجة بالذكاء الاصطناعي أن يبني لك ألعاباً ثنائية الأبعاد كاملة — سبرايتات، وخلفيات بارالاكس، وفيزياء، ومخاطر، ومُلتقطات، وتخطيطات المشاهد — وتمنحك محرراً مرئياً لضبط ما أخطأ فيه الوكيل بالسحب. **أنت تختار الوكيل** (Codex CLI أو Claude Code) و**أنت تختار نموذج الصور** (Gemini 2.5 Flash Image أو OpenAI gpt-image-1). اليوم، الناتج الافتراضي هو vanilla JS + Canvas (دون أي ارتباط بإطار عمل، يعمل في أي متصفح)؛ وأهداف محرّكَي Godot 4 وUnity مُدرجة على خارطة الطريق.

---

## ✨ نظرة سريعة

- 🤖 **أحضِر وكيلك الخاص** — Codex CLI أو Claude Code. بدّل في Settings. مباشرة.
- 🎨 **خط أنابيب أصول بجودة الإنتاج** — كروما-كي لأوراق السبرايت، رسوم متحركة متعددة الأفعال، بارالاكس بأربع طبقات قابلة للتبليط + إزالة الانعكاس اللوني — كل ذلك من الدرجة الأولى، وليس مضافاً لاحقاً.
- 🖼️ **توليد صور متعدد المزودين** — Gemini 2.5 Flash Image (رخيص، متعدد الوسائط أصلياً) أو OpenAI gpt-image-1 (مميز). أنت تقدّم مفتاح الـ API؛ ويبقى على جهازك.
- 🧱 **محرر مشاهد مرئي** — اسحب المنصات والمخاطر والمُلتقطات والمصادمات؛ طبقة عرض صناديق الإصابة؛ إعادة تحميل مباشرة في تبويب Play.
- 📦 **محرّكات متعددة على خارطة الطريق** — Web (vanilla JS + Canvas) يصدر اليوم دون أي ارتباط بإطار عمل (ادفع المجلد إلى GitHub Pages، وسيعمل). أهداف Godot 4 وUnity مُخطّطة.
- 💻 **محلي أولاً، مفتوح المصدر** — الـ daemon + واجهة الويب على `localhost`؛ ملفات مشروعك تبقى على قرصك؛ نية بأسلوب MIT.
- 💰 **شفافية في التكلفة** — لوحة Settings تعرض عدد استدعاءات توليد الصور اليوم والإنفاق المُقدّر بالدولار لكل مزود.

---

## 🎬 عرض توضيحي

**لقطة البطل** — نافذة AGF:

<p align="center">
  <img src="apps/web/public/hero-shot.png" alt="نافذة AGF الرئيسية" width="800" />
</p>

**Settings** — اختر وكيلك + مفاتيح API + إعدادات توليد الصور الافتراضية:

<p align="center">
  <img src="apps/web/public/setting.png" alt="نافذة AGF Settings" width="800" />
</p>

**محرر المشاهد** — اسحب المنصات والمخاطر والمُلتقطات والمصادمات:

<p align="center">
  <img src="apps/web/public/scene-editor.png" alt="محرر مشاهد AGF" width="800" />
</p>

---

## 🚀 البدء السريع

**المتطلبات**: Node ≥ 20، npm ≥ 10، و**واحد على الأقل** مما يلي:

- [Codex CLI](https://github.com/openai/codex) — `npm i -g @openai/codex`
- [Claude Code](https://github.com/anthropics/claude-code) — `npm i -g @anthropic-ai/claude-code`

```bash
git clone https://github.com/0x0funky/agent-game-forge.git
cd agent-game-forge
npm install
npm run dev
```

هذا يُشغّل:

- **Daemon** على <http://localhost:7621>
- **Web UI** على <http://localhost:7620>

افتح رابط الويب. انقر أيقونة الترس (أعلى اليمين) → **Settings**:

1. **Agent CLI** — اختر Codex أو Claude Code (أيهما ثبّتّه).
2. **API keys** (مطلوبة فقط لمسار Claude Code) — الصق مفتاح Gemini أو OpenAI الخاص بك. يكتبهما الـ daemon إلى `~/.ogf/secrets.json` (mode 600). متغيرات البيئة (`OPENAI_API_KEY`، `GEMINI_API_KEY`) تتجاوز الملف.
3. **Image-gen defaults** — اختر المزود + النموذج المفضّلين.

أغلق Settings. افتح مجلد مشروع. اكتب prompt مثل:

> *"منصات بتمرير جانبي عن كلب عائد إلى البيت، مع مراحل في سطح المبنى وبوابة الحديقة."*

اضغط إرسال. شاهد الوكيل وهو يبنيها. اضغط **Play** عندما يتوقف.

---

## 🧭 كيف يعمل

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

**1. تتحدث إلى الوكيل في المحادثة.** تبثّ واجهة الويب المحادثة؛ ويُمرّر SSE كل رمز + استدعاء أداة.

**2. يقرأ الوكيل اتفاقيات ومهارات AGF.** كل مشروع مُزوَّد محلياً بـ `.ogf/conventions/` (قواعد عامة + خاصة بكل نوع) و `.agents/skills/` (إجراءات توليد السبرايت + الخريطة). يتبع الوكيل الوصفات — ولا يُعيد اختراع خط الأنابيب.

**3. للصور، يستدعي الوكيل `/api/gen-image` الخاص بالـ daemon** (عبر `python .agents/tools/gen-image.py` أو `curl` مباشرة). يُوجّه الـ daemon الطلب إلى Gemini أو OpenAI باستخدام مفتاح الـ API المحفوظ لديك. يمكن لمستخدمي Codex الذين لديهم أداة `image_gen` المدمجة استخدامها بدلاً من ذلك — وكلا المسارين يُنتجان PNG مكافئة.

**4. يقرأ محرر المشاهد ويكتب نفس ملفات JSON** التي ينشئها الوكيل. اسحب منصة؛ ويُثبّت المحرر تصحيح JSON. حدّث عرض الوكيل؛ فيرى التحديث.

**5. زمن التشغيل هو المشروع نفسه.** الألعاب المُولّدة هي JS + Canvas خالصة — `index.html`، `src/*.js`، `data/*.json`، `assets/`. ادفع المجلد إلى GitHub Pages. تم.

---

## 📂 هيكل المستودع

```
open-game-forge/
├── packages/
│   └── contracts/      # أنواع TypeScript مشتركة: API, events, SceneModel
├── apps/
│   ├── daemon/         # Node.js + Express daemon (port 7621)
│   │   └── src/
│   │       ├── server.ts            # HTTP routes
│   │       ├── codex.ts             # Codex CLI adapter (spawn + stream-json)
│   │       ├── claude-code.ts       # Claude Code adapter (نفس النمط)
│   │       ├── agents.ts            # AgentAdapter dispatcher
│   │       ├── gen-image.ts         # Gemini + OpenAI router
│   │       ├── secrets.ts           # مخزن ~/.ogf/secrets.json
│   │       ├── prefs.ts             # مخزن ~/.ogf/preferences.json
│   │       ├── web-scene.ts         # مُحمِّل JSON level → SceneModel
│   │       ├── scenes.ts            # SceneOp applier (move/scale/add/remove)
│   │       └── templates/           # skills / conventions / recipes مُزوَّدة محلياً
│   └── web/            # Vite + React UI (port 7620)
│       └── src/
│           ├── App.tsx
│           ├── components/
│           │   ├── SceneEditor.tsx  # محرر مشاهد قائم على Canvas
│           │   ├── SettingsModal.tsx
│           │   └── PlayPane.tsx
│           └── lib/api.ts
└── docs/
    ├── architecture.md
    ├── roadmap.md
    └── genre-support.md
```

---

## 🛠️ البناء من المصدر

```bash
npm install           # تثبيت workspace
npm run build         # build contracts → daemon → web
npm run dev           # وضع watch للجميع (الـ daemon يُعيد التحميل عبر tsx)
```

أوامر مفيدة:

- `npm -w @ogf/daemon run dev` — الـ daemon فقط، مع `tsx watch`
- `npm -w @ogf/web run dev` — خادم تطوير Vite
- `npm -w @ogf/contracts run build` — فحص أنواع حزمة contracts

---

## 📋 حالة المشروع

| النوع | الحالة | ملاحظات |
|---|---|---|
| **منصات بتمرير جانبي** | ✅ أُطلق | خط أنابيب البارالاكس، المخاطر، المُلتقطات، الأعداء، متعدد المراحل، كروما-كي السبرايت |
| RPG بمنظور علوي | 🟡 جزئي | Foundation seed + وصفات؛ بعض الوصفات لا تزال تنضج |
| Tower defense / arena | 🟡 جزئي | موروث من فروع سابقة؛ يحتاج صقلاً |
| Roguelike / Metroidvania | 🟡 جزئي | بعد الإطلاق |

**أهداف المحرّكات**:

| المحرّك | الحالة | ملاحظات |
|---|---|---|
| **Web** (vanilla JS + Canvas) | ✅ افتراضي | قيد التطوير النشط. دون أي ارتباط بإطار عمل؛ ادفع المجلد إلى GitHub Pages وسيعمل. |
| **Godot 4** | 🟡 إرث + خارطة طريق | مشاريع Godot القائمة لا تزال تُحمَّل وتُحرَّر. إعادة استثمار من الدرجة الأولى ضمن خارطة الطريق بعد الإطلاق. |
| **Unity** | 🚧 مُخطّط | مُستهدف بعد وصول Godot من الدرجة الأولى. |

---

## 📚 التوثيق

- [`docs/architecture.md`](docs/architecture.md) — مبادئ التصميم، نمط الوكيل أولاً
- [`docs/roadmap.md`](docs/roadmap.md) — خطة مرحلية
- [`docs/genre-support.md`](docs/genre-support.md) — مصفوفة الأنواع
- ملفات الاتفاقيات (مُزوَّدة لكل مشروع) — [`apps/daemon/src/templates/conventions/`](apps/daemon/src/templates/conventions)
- الوصفات (مُزوَّدة لكل مشروع) — [`apps/daemon/src/templates/recipes/`](apps/daemon/src/templates/recipes)

---

## 🤝 المساهمة

نحن في مرحلة ما قبل الإطلاق. قاعدة الشيفرة صغيرة بما يكفي لاستقبال طلبات السحب، لكن من فضلك افتح تذكرة أولاً لمناقشة النطاق. أفضل الطرق للمساعدة الآن:

- **جرّبه وأبلغ عن الأخطاء** — افتح تذكرة مع سجل الـ daemon (`~/.ogf/claude-code-debug.jsonl` أو طرفية الصدفة حيث يعمل `npm run dev`)
- **اصنع لعبة** وأرِنا — يسعدنا عرضها في الـ README
- **اختبر على macOS / Linux** — المطوّر الرئيسي يعمل على Windows؛ من المرجح أن تختبئ مشاكل عبر الأنظمة

---

## 🔐 الأمان والبيانات

- **يبقى رمزك على جهازك.** AGF محلي أولاً. يرتبط الـ daemon بـ `127.0.0.1`؛ لا يغادر شيءٌ جهازك سوى الاستدعاءات لمزود الذكاء الاصطناعي الذي اخترته.
- **مفاتيح الـ API** تُخزَّن في `~/.ogf/secrets.json` بوضع ملف 600 (للمالك فقط). لا تدخل git أبداً، ولا تظهر في سجلات AGF.
- **المحادثات** تُخزَّن في `~/.ogf/ogf.db` (SQLite). احذف الملف لإعادة التعيين.

---

## 📜 الترخيص

مرخّص بموجب [Apache License, Version 2.0](LICENSE). يمكنك الاستخدام والتعديل و fork والنشر بحرية — تجاريّاً كان أو غير ذلك. فقط احتفظ بإشعار حقوق النشر والترخيص.

---

## 🙏 الشكر والتقدير

- نمط daemon-and-spawn مُقتبس من [`nexu-io/open-design`](https://github.com/nexu-io/open-design)
- خط أنابيب توليد السبرايت مُقتبس من [`0x0funky/agent-sprite-forge`](https://github.com/0x0funky/agent-sprite-forge)
- مبنيٌّ بـ Codex CLI + Claude Code — نعم، هذا المشروع كُتب في معظمه بنفس الوكلاء الذين يقودهم

---

<p align="center">
  مصنوع لمطوّري الألعاب المستقلين الذين يحبون الإطلاق.<br/>
  <a href="https://github.com/0x0funky/agent-game-forge/issues">الإبلاغ عن خطأ</a> ·
  <a href="https://github.com/0x0funky/agent-game-forge/discussions">Discussions</a>
</p>
