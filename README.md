# Smart Agent Route

<p align="center"><b>繁體中文</b> · <a href="README.en.md"><b>English</b></a></p>

Claude Code plugin:**主對話用 Opus 思考,執行派給 Sonnet,檢索與大量讀取交給 Haiku**;context 過長時提醒並寫交接筆記,讓對話可以放心清空;知識跨對話累積,外部資料附來源。

> A Claude Code plugin for tiered model delegation — Opus plans, Sonnet executes, Haiku retrieves and digests bulk output — plus context-length reminders with handoff notes so the main conversation stays short, and persistent, source-cited memory that accumulates across conversations. English documentation: [README.en.md](README.en.md).

---

## 安裝

```
/plugin install smart-agent-route --marketplace Novie131/smart-agent-route
/reload-plugins
```

(Claude Code 2.1.275 以前:先 `/plugin marketplace add Novie131/smart-agent-route`,再 `/plugin install smart-agent-route@smart-agent-route`。)

裝完即可用,不必再手動設定。想要完整功能(context 狀態列、自動壓縮門檻、Haiku 版 Explore、claude-memory 記憶庫),在 Claude Code 裡執行:

```
/smart-agent-route:route-setup
```

它會一項一項說明做什麼、影響、怎麼還原,一次只問一項,可以隨時略過;寫 `settings.json` 前會備份,已有的值不覆蓋。沒做 route-setup 時,session 開始會提示你(最多 3 次)。主對話模型建議設成 Opus(`/model opus`),這個不會自動改。

沒有 `claude-memory/` 時,記憶退回 Claude Code 自己的 auto memory,一樣可用;`claude-memory/` 是進階選項(可進 git、跨環境共用)。

context 長度提醒需要 `python3`,沒有的話會安靜停用。

不想用 marketplace 的話,repo 內附 `install.sh`,或直接 `claude --plugin-dir ./plugins/smart-agent-route`。

### 用 install.sh 安裝

```
bash install.sh                    # 複製安裝(agent、skill、hook 放進 ~/.claude/,沒有命名空間前綴;重跑即更新)
bash install.sh --agents-only      # 只複製 agent(hook 與 skill 不會生效)
bash install.sh --link             # 用符號連結裝 agent、skill、hook(改 repo 立即生效)
bash install.sh --uninstall        # 移除(依安裝清單,不動你自己的檔案)
bash install.sh --with-explore     # 另外安裝 Haiku 版 Explore 到 ~/.claude/agents/
bash install.sh --with-statusline  # 另外在 ~/.claude/settings.json 加 context 狀態列
```

注意事項:

- 這種模式下名稱沒有命名空間:agent 是 `worker`,skill 是 `/handoff`(plugin 安裝則是 `smart-agent-route:worker`)。
- 裝了哪些東西記在 `~/.claude/.smart-agent-route-installed`。內容完全相同的既有檔案會併入清單;內容不同的(你自己的)不會覆蓋,並給警告。
- `--with-statusline` 可與預設的複製模式或 `--link` 併用,不能與 `--agents-only`、`--uninstall` 併用。它只動 `settings.json` 的 `statusLine` 這個 key:檔案不存在就建立,已有 `statusLine` 絕不覆蓋(只印出建議片段),其餘情況寫入前先備份成 `settings.json.bak-<timestamp>`。JSON 壞掉或沒有 python3 時什麼都不做。
- install.sh 不會改你 `settings.json` 裡的 hooks,結尾會印出一段片段,由你自己併進 `"hooks"`。之後執行 `/route-setup` 取得完整功能。

更多說明見 [docs/部署安裝.md](docs/部署安裝.md)與 [plugins/smart-agent-route/INSTALL.md](plugins/smart-agent-route/INSTALL.md)(英文版:[INSTALL.en.md](plugins/smart-agent-route/INSTALL.en.md))。

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

各元件的用途:

- **worker**(Sonnet,`effort: medium`):方向已定、動手做的事,例如寫程式、修 bug、補測試。回報完成前必須先驗證。
- **worker-hard**(Sonnet,`effort: high`):只在 worker 失敗後使用,派工時必須附上前次失敗報告。
- **bulk**(Haiku):大量讀取、只回結論:大量圖片、長 log、網頁、輸出很多的指令,以及機械式的批次修改。
- **librarian**(Haiku,`effort: low`):查知識庫與記憶。只有 `Read`、`Glob`、`Grep`,所以什麼都改不了;回傳原文片段與來源,並說明搜過哪些詞、什麼沒找到。
- **harvester**(Sonnet):把歷史對話逐字稿挖進知識庫筆記。只在你明確要求時才跑,是成本不低的批次作業。
- **Explore**(Haiku,選裝):內建 Explore 在主對話是 Opus 時也跑 Opus。plugin 蓋不掉它(只有使用者或專案層級、名為 `Explore` 的 agent 能覆蓋),所以用 route-setup 或 `bash install.sh --with-explore` 把 Haiku 版裝進 `~/.claude/agents/`。
- **Skills**:`handoff` 寫 `handoff.md`;`research` 查外部資料並附來源;`usage-stats` 量測主對話 context 長度與子 agent 完成的工作比例(唯讀);`route-setup` 是一次性完整設定。
- **Hooks**:SessionStart 帶入分工慣例、記憶索引與交接筆記;UserPromptSubmit 在 context 過長時提醒。

**路由發生在 Opus 之後,不是之前。** 判斷意圖就得先讀懂訊息,而讀懂即規劃 —— 所以沒辦法在前面放一個便宜的路由器。Opus 永遠是入口,由它派工。

成本上仍划算:規劃是一則訊息,執行迴圈常是數十次工具呼叫。而且最大的一筆省在 **context 隔離** —— 對話中每則訊息在後續每一輪都會重送,把工具呼叫關進 subagent 的獨立 context,主對話只收摘要。

**但隔離只管得到工具呼叫,管不到對話本身變長。** 實測一個重度使用者 21 個 session,主對話每次呼叫的 context 中位數約 24 萬 token,大多是在重讀舊對話。所以 plugin 另外盯著長度:超過 10 萬 token 時提醒,Claude 用 handoff skill 寫下現況,約 12 萬自動壓縮,壓縮後新 context 自動帶回交接筆記,不用手動 `/clear`。

設計理由與取捨見 [docs/spec.md](docs/spec.md)。

### 委派與失敗升級

正常講話就好,主對話會自己判斷該不該派工。例如:幫我想清楚該怎麼做,留在 Opus;「照剛才講的做」派給 worker;「我之前有記過 X 嗎」派給 librarian;「看一下這 18 張截圖有沒有跑版」「這份 log 為什麼失敗」派給 bulk;「這個 API 新版怎麼設定」用 research skill,回答附來源,官方資料存進 `claude-memory/web/`;「交接一下」或 hook 提醒 context 過長,用 handoff skill 寫 `handoff.md`,之後可以 `/clear`。想強制指定某個 subagent,用 `@agent-smart-agent-route:worker`。

主對話怎麼分工,不靠你的 CLAUDE.md:plugin 的 SessionStart hook 會在每個 session 開始時把分工表帶進去(內容見 `hooks/guide.md`)。

失敗升級依序:補背景後同一個 agent 重派 → bulk 失敗改 worker → worker 失敗改 worker-hard(附前次失敗報告)→ 仍失敗就停下來重新規劃或問你。不會無限升級。

### 子 agent 回報格式

子 agent 收工時用固定的回報格式,讓主對話只看前兩行就能決定下一步:狀態行(完成、失敗、需要決策)與驗證行(通過、未驗證、失敗)。「完成」只能搭配「驗證通過」。子 agent 遇到需要決策的岔路時,會停下來回報有哪些選項與各自的影響,不會自己選一條路走完。

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

- 不好:`setup.md — 環境設定相關`(這是主題)
- 好:`setup.md — 要改路徑或指令跑不起來時先讀`(這是條件)

記憶放在哪裡:

- agent 優先使用已連接(工作)資料夾裡的 `claude-memory/`,找不到才退回自己的 agent 記憶目錄(`~/.claude/agent-memory/worker/`)。
- Claude Code(終端機)裡退回路徑可以跨對話存活。Cowork(桌面版)的沙盒家目錄每個 session 重建,只有連接資料夾活得下來:每次開新對話都要重新連接。
- 沒有 `claude-memory/` 時,記憶退回 Claude Code 的 auto memory。如果你關過 `autoMemoryEnabled` 或設了 `CLAUDE_CODE_DISABLE_AUTO_MEMORY`,`memory` 欄位不會生效,連接資料夾就從選用變成必要。
- 資料夾直接用 Obsidian 開就是一個 vault,不需要任何整合 —— vault 本來就只是一堆 `.md`。請開新的專用 vault,不要指向你現有的個人筆記,因為 agent 有寫入權。
- 記憶要記「下次怎麼做」,不是「這次做了什麼」。流水帳不會讓下一次變快。

保持 `MEMORY.md` 薄很重要:超過上限會被截斷(hook 最多帶入 120 行,auto memory 200 行),而且常駐內容是每個 session 都付的固定成本。它會腐化,需要定期整理;超過 150 行就是警訊。

---

## 這是 RAG,只是不用向量

`librarian` 用關鍵詞搜尋與條件判斷做檢索。個人規模(數十到數百篇)這樣通常比向量好:不用多一套基礎設施、檢索失敗看得出原因、不會因為切塊破壞 Markdown 的結構。而且它會換同義詞、換語言、改搜檔名重試,固定的向量查詢做不到。

上千篇或大量 PDF、長逐字稿才值得考慮向量。屆時 `kb/` 的 markdown 直接當語料。

---

## 省 token 與 context window

四個槓桿,照影響大小排序:

1. **Context 隔離**(最大的一筆,而且是複利)。每一則訊息、每一次工具回傳,在後續每一輪都會被重新送一次。在主對話裡跑 30 次工具呼叫,那 30 份結果會被反覆計費到對話結束;派給 subagent 的話,主對話只收到一份摘要。派工要整包派,不要一件一件派,因為每次啟動 subagent 都要重付一次系統提示與記憶注入。
2. **模型分層。** 有用,但是線性的:省的比例大致等於價差。
3. **`effort` 等級。** worker 用 `medium`,失敗才升級到 worker-hard(`high`);librarian 用 `low`。
4. **主對話別開太久。** Opus 掛著一段持續變長的對話是最安靜的漏斗。UserPromptSubmit hook 在 context 超過 10 萬 token 時提醒一次,之後每多 4 萬再提醒(門檻可用環境變數 `CONTEXT_REMIND_TOKENS` 調整)。提醒時 Claude 會用 handoff skill 把現況寫進 `handoff.md`(目前任務 / 已完成 / 下一步 / 未決問題)。有設 `autoCompactWindow`(見下)時,只會告訴你約 N k 會自動壓縮、壓縮後會帶回交接筆記;沒設才給可複製的指令:告一段落 `/clear`、做到一半 `/compact` 並指定重點、後半段是除錯雜訊就 `/rewind` 局部摘要。每次壓縮、`/clear`、新 session 開始時,SessionStart hook 自動帶入 `handoff.md`:專案有 `claude-memory/` 就用它,否則用 transcript 旁 auto memory 目錄的 `handoff.md`(Claude Code 只會自動帶入 auto memory 的 MEMORY.md 索引,不會帶 handoff.md)。話題告一段落時,換新對話或 `/clear` 仍然更省。

建議在 `~/.claude/settings.json` 把自動壓縮當保險(plugin 不能代設,`/smart-agent-route:route-setup` 會幫你安全地寫入):

```
"autoCompactWindow": 153000
```

扣掉約 33k 的 buffer 後,約在 12 萬自動壓縮,在 10 萬提醒之後留 2 萬緩衝寫 handoff。33k 是作者機器的實測值(不確定是否固定);寫入後請用 `/context` 確認 Autocompact buffer 約 33k、壓縮點約 120k(有 `modelSettings` 逐模型覆蓋時要一併看)。

**狀態列**(選用):顯示 `模型 │ ctx 95k │ 提醒 100k │ 壓縮 120k`,壓縮點讀自 `autoCompactWindow`(沒設就不顯示)。plugin 不能設定主狀態列,用 `bash install.sh --with-statusline`,或手動貼進 settings.json(路徑只適用 install.sh 安裝;plugin 安裝的使用者請用 `/smart-agent-route:route-setup`,它會把檔案放到固定位置):

```json
"statusLine": { "type": "command", "command": "python3 ~/.claude/hooks/smart-agent-route/statusline.py" }
```

提醒文字也會帶入預估的壓縮點。

**看固定成本**:想知道每一輪固定要付多少(系統提示、工具定義、MCP、skills、記憶檔),在對話裡輸入 `/context`,或在 terminal 跑 `claude -p "/context"`(不用開互動對話,在本機計算、不呼叫模型)。作者機器上新對話的固定成本約 29k token,其中約 18k 是 Claude Code 內建的系統提示與工具定義;標為 deferred 的工具用到才載入,不計入。固定內容每輪都會命中快取,通常不是大頭,先處理對話長度與輸出,再考慮拔掉不用的 MCP 或 plugin。

---

## 擴充:什麼時候加 Haiku 層

`skills/route-setup/templates/runner.md.example` 是預留的位置,**刻意不載入**。Haiku 層是唯一真正省錢、也唯一真正有風險的一層:它不會停下來問你,會照著它以為的意思安靜做完。所以每個 Haiku agent 都必須綁死在一件具體任務上。三個條件同時成立才啟用:這件事你已經做過三到五次,流程幾乎一樣;成功的樣子明確到一眼能判斷;做錯可承受且可回復(不刪東西、不送出去、不覆蓋無備份的檔案)。任何一項不成立,就繼續留在 worker。檢索(librarian)是例外,因為它是唯讀的。

---

## 知識庫與 harvester

餵知識庫有兩種方式:自己把 `.md` 放進 `kb/`(不用任何前處理,librarian 立刻找得到),或叫 `harvester` 去挖歷史對話(它會先列出可讀的 session 讓你選範圍)。先講清楚四個限制:

- 只看得到本機的 session;網頁版或手機上的對話不在範圍內。
- 成本不低,所以是偶爾跑一次的批次作業,不是常駐功能。
- 萃取一定會失真:產出值得抽查,尤其是頭幾次。
- 它會寫進 `kb/`,而那原本是你自己的東西。如果你在意這條界線,先叫它寫到 `kb/harvested/`。

第一次安裝後跑一次,把已經累積的東西撈起來當起點;之後 worker 收工時會即時寫記憶,就很少需要再跑。

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
