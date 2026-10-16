---
name: usage-stats
description: 量測主對話 context 長度與子 agent 使用比例,做優化前後比較時使用。
---
# Usage stats

執行 `python3 "${CLAUDE_SKILL_DIR}/usage_stats.py"`,使用者給的參數原樣帶上:`--since YYYY-MM-DD`、`--until YYYY-MM-DD`、`--project 子字串`(只算目錄名含該字串的專案)、`--threshold N`(預設讀環境變數 `CONTEXT_REMIND_TOKENS`,再預設 120000)。只讀 `~/.claude/projects` 的紀錄,不寫任何東西。

## 怎麼回報

把結果直接摘要給使用者,依序講:

1. 主對話 context 中位數是否低於 10 萬
2. 有沒有呼叫超過 15 萬(看最大值與超過門檻的比例)
3. 子 agent 呼叫比例,以及有派過子 agent 的 session 比例
4. 哪一類子 agent 跑在 Opus 上(看「agent 類型」表,模型欄含 opus 的列);類型顯示「(未知)」代表找不到對應的 meta 檔

子 agent 的 output 欄位會嚴重低估(紀錄檔只記到串流開頭的值),不要拿來比較成本。

不要貼整張表,除非使用者要。要比較優化前後,請使用者給兩段日期各跑一次。
