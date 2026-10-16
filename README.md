# Smart Agent Route

[English](README.en.md) | 繁體中文

Claude Code plugin:**主對話用 Opus 思考,執行派給 Sonnet,檢索與大量讀取交給 Haiku**;context 過長時提醒並寫交接筆記,讓對話可以放心清空;知識跨對話累積,外部資料附來源。

> A Claude Code plugin for tiered model delegation — Opus plans, Sonnet executes, Haiku retrieves and digests bulk output — plus context-length reminders with handoff notes so the main conversation stays short, and persistent, source-cited memory that accumulates across conversations. Documentation is in Traditional Chinese.

---

## 安裝

```
/plugin install smart-agent-route --marketplace Novie131/smart-agent-route
/reload-plugins
```

(Claude Code 2.1.275 以前:先 `/plugin marketplace add Novie131/smart-agent-route`,再 `/plugin install smart-agent-route@smart-agent-route`。)

裝完即可用，不必再手動設定。想要完整功能（context 狀態列、自動壓縮門檻、Haiku 版 Explore、claude-memory 記憶庫），在 Claude Code 裡執行：

```
/smart-agent-route:route-setup
```

它會一項一項說明做什麼、影響、怎麼還原，一次只問一項，可以隨時略過；寫 `settings.json` 前會備份，已有的值不覆蓋。沒做 route-setup 時，session 開始會提示你（最多 3 次）。主對話模型建議設成 Opus（`/model opus`），這個不會自動改。

沒有 `claude-memory/` 時，記憶退回 Claude Code 自己的 auto memory，一樣可用；`claude-memory/` 是進階選項（可進 git、跨環境共用）。

context 長度提醒需要 `python3`,沒有的話會安靜停用。

不想用 marketplace 的話,repo 內附 `install.sh`,或直接 `claude --plugin-dir ./plugins/smart-agent-route`。

完整說明見 [docs/部署安裝.md](docs/部署安裝.md)。

---

## 架構

```
你 ──► 主對話(Opus)          ← 大門。理解、判斷、決定派給誰
          │
          ├──► worker(Sonnet)       ← 方向已定、動手做的事
          │      └► worker-hard      ← worker 失敗後的升級
          ├──► bulk(Haiku)          ← 大量讀取只要結論:圖片、長 log、網頁
          ├──► librarian(Haiku)     ← 查知識庫。唯讀
          └──► harvester(Sonnet)    ← 挖歷史對話進知識庫。手動觸發

skill:handoff(交接筆記)、research(查外部資料並附來源)、usage-stats(量測 context 與子 agent 用量)、route-setup(一次性完整設定)
hook :session 開始帶入分工慣例與記憶;context 過長時提醒
```

**路由發生在 Opus 之後,不是之前。** 判斷意圖就得先讀懂訊息,而讀懂即規劃 —— 所以沒辦法在前面放一個便宜的路由器。Opus 永遠是入口,由它派工。

成本上仍划算:規劃是一則訊息,執行迴圈常是數十次工具呼叫。而且最大的一筆省在 **context 隔離** —— 對話中每則訊息在後續每一輪都會重送,把工具呼叫關進 subagent 的獨立 context,主對話只收摘要。

**但隔離只管得到工具呼叫,管不到對話本身變長。** 實測一個重度使用者 21 個 session,主對話每次呼叫的 context 中位數約 24 萬 token,大多是在重讀舊對話。所以 plugin 另外盯著長度:超過 10 萬 token 時提醒,Claude 用 handoff skill 寫下現況,約 12 萬自動壓縮,壓縮後新 context 自動帶回交接筆記,不用手動 `/clear`。

設計理由與取捨見 [docs/spec.md](docs/spec.md)。

---

## 記憶

```
<你的資料夾>/claude-memory/
├── MEMORY.md    ← 常駐索引,session 開始時由 hook 帶入,預算 40 行
├── handoff.md   ← 交接筆記,下個 session 自動帶入
├── topics/      ← agent 累積的知識
├── kb/          ← 你自己的筆記
└── web/         ← research 存的外部資料筆記(附來源與過期日)
```

`MEMORY.md` **只放觸發條件,知識本體放主題檔**。這讓成本跟「這次用得到多少」成正比,而不是「總共記得多少」—— 知識可以無限成長,每次啟動的固定成本不變。

索引寫成條件,不是主題:

- ✗ `setup.md — 環境設定相關`
- ✓ `setup.md — 要改路徑或指令跑不起來時先讀`

資料夾直接用 Obsidian 開就是一個 vault,不需要任何整合 —— vault 本來就只是一堆 `.md`。

---

## 這是 RAG,只是不用向量

`librarian` 用關鍵詞搜尋與條件判斷做檢索。個人規模(數十到數百篇)這樣通常比向量好:不用多一套基礎設施、檢索失敗看得出原因、不會因為切塊破壞 Markdown 的結構。而且它會換同義詞、換語言、改搜檔名重試,固定的向量查詢做不到。

上千篇或大量 PDF、長逐字稿才值得考慮向量。屆時 `kb/` 的 markdown 直接當語料。

---

## 目錄

```
smart-agent-route/
├── .claude-plugin/marketplace.json   ← 市集目錄
├── plugins/smart-agent-route/            ← plugin 本體
│   ├── .claude-plugin/plugin.json
│   ├── agents/                       ← worker / worker-hard / bulk / librarian / harvester
│   ├── skills/                       ← handoff / research / usage-stats / route-setup
│   ├── hooks/                        ← SessionStart 帶入、context 長度提醒
│   （範本在 skills/route-setup/templates/：MEMORY.md、知識庫說明、Explore、Haiku 層範本）
├── docs/
│   ├── spec.md                       ← 架構設計與實作附錄
│   ├── 部署安裝.md
│   └── 發佈到-GitHub.md
├── claude-memory/                    ← 記憶庫(不進版控)
└── install.sh                        ← 不用 marketplace 的安裝方式
```

---

## 狀態

**v0.8.0 — 早期版本。** 0.7.0 以前叫 tiered-agents,升級請先移除舊版(見 [docs/部署安裝.md](docs/部署安裝.md#從-tiered-agents070-以前升級))。 context 提醒 hook、handoff、bulk、Explore 覆蓋版移植自作者的個人設定:hook 已在真實對話中觸發、Explore 與 bulk 已確認跑在 Haiku,但都還在驗證期。worker-hard 升級鏈、research skill 與 plugin 形式的 hook 尚未實際使用。

已知會需要調整的地方:

- 委派靠 `description` 匹配,不是保證。要確定就 `@agent-smart-agent-route:worker`
- hook 在 Cowork 的行為未驗證
- `MEMORY.md` 會腐化,需要你定期整理(超過 150 行即是訊號)
- Haiku 執行層預設留空,見 `plugins/smart-agent-route/skills/route-setup/templates/runner.md.example` 的啟用條件
- `harvester` 只讀得到本機 session

歡迎開 issue。

---

## 授權

MIT
