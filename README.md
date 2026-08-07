# SmartRouteAI

Claude Code plugin:**主對話用 Opus 思考,執行派給 Sonnet,檢索交給 Haiku**,並讓知識跨對話累積。

> A Claude Code plugin for tiered model delegation — Opus plans, Sonnet executes, Haiku retrieves — with persistent memory that accumulates across conversations. Documentation is in Traditional Chinese.

---

## 安裝

```
/plugin marketplace add Novie131/SmartRouteAI
/plugin install tiered-agents@tiered-agents
/reload-plugins
```

裝完還要做兩件事(plugin 不會自動處理):

```
/model opus
```

```bash
mkdir -p <你的資料夾>/claude-memory/{topics,kb}
```

再把 `plugins/tiered-agents/templates/MEMORY.md` 複製進 `claude-memory/`。

不想用 marketplace 的話,repo 內附 `install.sh`,或直接 `claude --plugin-dir ./plugins/tiered-agents`。

完整說明見 [docs/部署安裝.md](docs/部署安裝.md)。

---

## 架構

```
你 ──► 主對話(Opus)          ← 大門。理解、判斷、決定派給誰
          │
          ├──► worker(Sonnet)     ← 方向已定、動手做的事
          ├──► librarian(Haiku)   ← 查資料。唯讀
          └──► harvester(Sonnet)  ← 挖歷史對話進知識庫。手動觸發
```

**路由發生在 Opus 之後,不是之前。** 判斷意圖就得先讀懂訊息,而讀懂即規劃 —— 所以沒辦法在前面放一個便宜的路由器。Opus 永遠是入口,由它派工。

成本上仍划算:規劃是一則訊息,執行迴圈常是數十次工具呼叫。而且最大的一筆省在 **context 隔離** —— 對話中每則訊息在後續每一輪都會重送,把工具呼叫關進 subagent 的獨立 context,主對話只收摘要。

設計理由與取捨見 [docs/spec.md](docs/spec.md)。

---

## 記憶

```
<你的資料夾>/claude-memory/
├── MEMORY.md    ← 常駐索引,每次自動注入,預算 40 行
├── topics/      ← agent 累積的知識
└── kb/          ← 你自己的筆記
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
SmartRouteAI/
├── .claude-plugin/marketplace.json   ← 市集目錄
├── plugins/tiered-agents/            ← plugin 本體
│   ├── .claude-plugin/plugin.json
│   ├── agents/                       ← worker / librarian / harvester
│   └── templates/                    ← MEMORY.md、知識庫說明、Haiku 層範本
├── docs/
│   ├── spec.md                       ← 架構設計與實作附錄
│   ├── 部署安裝.md
│   └── 發佈到-GitHub.md
├── claude-memory/                    ← 記憶庫(不進版控)
└── install.sh                        ← 不用 marketplace 的安裝方式
```

---

## 狀態

**v0.6.0 — 早期版本,尚未經長期實際使用驗證。**

已知會需要調整的地方:

- 委派靠 `description` 匹配,不是保證。要確定就 `@agent-worker`
- `MEMORY.md` 會腐化,需要你定期整理(超過 150 行即是訊號)
- Haiku 執行層預設留空,見 `plugins/tiered-agents/templates/runner.md.example` 的啟用條件
- `harvester` 只讀得到本機 session

歡迎開 issue。

---

## 授權

MIT
