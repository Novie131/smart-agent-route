# 三種環境怎麼裝

先講結論:

| 環境 | 裝法 | 跟誰共用 |
|---|---|---|
| **Cowork(桌面版)** | 點 `.plugin` 檔安裝 | 自成一套 |
| **Claude Code CLI** | 跑 `install.sh` | ← 跟 VS Code 共用 |
| **VS Code 擴充** | 同上,裝一次兩邊都有 | ← 跟 CLI 共用 |

**CLI 和 VS Code 共用 `~/.claude/`,所以裝一次兩邊都吃得到。** Cowork 走自己的安裝流程,要另外裝一次。

---

## Cowork(桌面版)

點 `.plugin` 檔的安裝按鈕就好,裝完立刻生效,而且**所有對話都能用**(plugin 是使用者層級,不綁對話)。

要驗證的話,在新對話問「有哪些 agent 可以用?」,應該看得到 `worker`、`worker-hard`、`bulk`、`librarian`、`harvester`。

---

## Claude Code CLI 與 VS Code 擴充

這兩個共用同一份設定,所以下面做一次就好。

### 一鍵安裝

在 repo 根目錄執行(或把 `install.sh` 和 `smart-agent-route.plugin` 放同一個目錄;沒有 `.plugin` 時腳本會直接用 `plugins/smart-agent-route/`):

```bash
bash install.sh
```

腳本會把 plugin 解到 `~/.claude/skills/smart-agent-route/`,那裡的 plugin 會**自動載入**,不需要 marketplace、不需要 `/plugin install`。

裝完重開 Claude Code(或在既有 session 執行 `/reload-plugins`)。

### 驗證

```
/context
```

在 **Custom Agents** 區塊應該看得到五個 agent。或直接 @-mention 試試:

```
@agent-smart-agent-route:worker
```

搜程式碼也想改用 Haiku 的話,加上 `--with-explore`(會把 `templates/Explore.md` 放到 `~/.claude/agents/`,已存在則不覆蓋):

```bash
bash install.sh --with-explore
```

### 如果 agent 沒出現

改用備援模式,直接把 agent 定義放進使用者層級的 agents 目錄:

```bash
bash install.sh --agents-only
```

這條路更原始但更保險——`~/.claude/agents/` 是 Claude Code 讀取使用者 subagent 的標準位置。代價是失去 plugin 的命名空間與版本管理,agent 會以 `worker` 而不是 `smart-agent-route:worker` 出現。

### 想自己維護、改了立即生效

```bash
bash install.sh --link
```

把 agent、skill、hook 用符號連結接到 repo 裡的檔案,`git pull` 或自己改完就生效,不用重裝。名稱不帶命名空間(`worker`、`/handoff`)。腳本不改 `settings.json`,會印出 hook 設定片段讓你自己貼。已存在的同名檔一律不覆蓋;repo 搬家後重跑一次即可。

### 只想先試不想裝

```bash
claude --plugin-dir ./smart-agent-route.plugin
```

`--plugin-dir` 吃得下 zip 壓縮檔,而 `.plugin` 就是 zip。這只對當次 session 有效,適合先試用。

---

## 版本需求

這個 plugin 用到幾個較新的 frontmatter 欄位:

| 欄位 | 用途 | 沒支援會怎樣 |
|---|---|---|
| `model` | 指定 agent 用哪個模型 | 全部跟隨主對話模型,分層失效 |
| `memory` | 持久記憶 | 記憶功能失效(但連接資料夾那條路仍可用) |
| `effort` | 依失敗代價配置推理量 | 跟隨 session 設定 |
| `omitClaudeMd` | bulk 不載入 CLAUDE.md(需 2.1.271+) | 會多載入 CLAUDE.md,較貴但可用 |

context 長度提醒 hook 需要 `python3`;找不到時安靜停用。

檢查版本:

```bash
claude --version
```

太舊的話:

```bash
claude update
```

另外 `memory` 依賴 auto memory。如果你關過 `autoMemoryEnabled`,或設了環境變數 `CLAUDE_CODE_DISABLE_AUTO_MEMORY`,那個欄位不會生效——這種情況下改用「連接資料夾裡的 `claude-memory/`」那條路(worker 本來就優先走它)。

---

## 主對話模型要另外設

**plugin 只定義 subagent,不會改你主對話的模型。** 分層架構的第一層要自己開:

```
/model opus
```

或寫進 `~/.claude/settings.json`:

```json
{ "model": "opus" }
```

沒設的話,主對話會用你原本的預設模型,派工判斷的品質會下降。

---

## 記憶資料夾在各環境的差別

記憶存在**你自己指定的資料夾**裡,不在 plugin 裡。三個環境的接法不同:

- **Cowork**:每次開新對話時把記憶資料夾連接進來。這是唯一需要重複做的動作,忘了連就等於失憶。
- **CLI**:在記憶資料夾底下開 session,或把它當專案根目錄。
- **VS Code**:把記憶資料夾加進工作區。

三個環境指向**同一個資料夾**的話,記憶就是共用的。這也是為什麼建議用 Obsidian 開那個資料夾——它同時是 agent 讀寫的地方、你檢視整理的地方、以及各環境連接的目標。

---

## 更新

重跑一次 `install.sh` 即可,它會覆蓋舊版本。Cowork 那邊則是重新點一次新的 `.plugin` 檔。

**兩邊要記得都更新。** 版本不一致時行為會不一樣,而這種問題很難察覺——你會以為是 agent 不穩定,其實是兩台在跑不同版本。
