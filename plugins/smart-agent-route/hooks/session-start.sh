#!/bin/sh
# SessionStart hook：把分工慣例、claude-memory/ 的記憶索引與交接筆記帶進主對話。
# stdout 的純文字會成為 Claude 的 context。只用 sh 與 awk，不依賴 python；
# 任何錯誤都安靜結束，不擋 session。
ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$0")/..}"
MEM="${CLAUDE_PROJECT_DIR:-$PWD}/claude-memory"

# 去掉 HTML 註解與空行：範本裡的說明是寫給人看的，不值得每個 session 付費
strip() { awk '/<!--/{c=1} !c && NF{print} /-->/{c=0}' "$1" | head -n "$2"; }

cat "$ROOT/hooks/guide.md" 2>/dev/null

if [ -f "$MEM/MEMORY.md" ]; then
  printf '\n# 記憶索引（%s/MEMORY.md）\n\n' "$MEM"
  strip "$MEM/MEMORY.md" 120
fi

if [ -f "$MEM/handoff.md" ]; then
  printf '\n# 上一個對話留下的交接筆記（%s/handoff.md）\n\n' "$MEM"
  strip "$MEM/handoff.md" 80
fi

exit 0
