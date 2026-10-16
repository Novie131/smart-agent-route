#!/bin/sh
# SessionStart hook：把分工慣例、claude-memory/ 的記憶索引與交接筆記帶進主對話。
# 只用 sh 與 awk，不依賴 python；任何錯誤都安靜結束，不擋 session。
#
# 沒有 claude-memory/ 時刻意「不」帶入 auto memory 的 MEMORY.md：Claude Code 本來就會自己帶，
# 這裡再帶一次只會重複付費。
#
# 沒有 claude-memory/ 時，改從 stdin 的 transcript_path 找 auto memory 目錄（同層的 memory/），
# 只帶入其中的 handoff.md：auto memory 只有 MEMORY.md 索引會被 Claude Code 自動帶入，handoff.md 不會，
# 壓縮或 /clear 後就漏讀了。
#
# 「安裝後零手動」：尚未跑過 route-setup（沒有標記檔）且提示顯示不到 3 次時，輸出 JSON，
# 用 systemMessage 給使用者一句提示，原本的全部文字放進 additionalContext；否則照舊輸出純文字。
MEM="${CLAUDE_PROJECT_DIR:-$PWD}/claude-memory"
HERE=$(dirname "$0")
STATE="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/hooks}"
DONE="$STATE/.route-setup-done"
SHOWN="$STATE/.route-setup-shown"

# 去掉 HTML 註解與空行：範本裡的說明是寫給人看的，不值得每個 session 付費
strip() { awk '/<!--/{c=1} !c && NF{print} /-->/{c=0}' "$1" | head -n "$2"; }

# 從 stdin 的 JSON 取出 transcript_path（處理 \" 與 \\ 跳脫）；沒有輸入、是終端機、格式不對都回傳空
read_transcript_path() {
  [ -t 0 ] && return 0
  cat 2>/dev/null | awk '
    { buf = buf $0 "\n" }
    END {
      i = index(buf, "\"transcript_path\"")
      if (!i) exit
      rest = substr(buf, i + 17)
      if (!match(rest, /^[ \t\r\n]*:[ \t\r\n]*"/)) exit
      rest = substr(rest, RLENGTH + 1)
      out = ""
      n = length(rest)
      for (j = 1; j <= n; j++) {
        c = substr(rest, j, 1)
        if (c == "\\") {
          j++; c = substr(rest, j, 1)
          if (c == "n") c = "\n"; else if (c == "t") c = "\t"
          out = out c
        } else if (c == "\"") { printf "%s", out; exit }
        else out = out c
      }
    }' 2>/dev/null
}

AUTO_HANDOFF=""
if [ ! -d "$MEM" ]; then
  tp=$(read_transcript_path)
  if [ -n "$tp" ]; then
    case "$tp" in
      */*) cand="${tp%/*}/memory/handoff.md" ;;
      *) cand="" ;;
    esac
    [ -n "$cand" ] && [ -f "$cand" ] && AUTO_HANDOFF="$cand"
  fi
fi

body() {
  cat "$HERE/guide.md" 2>/dev/null
  if [ -f "$MEM/MEMORY.md" ]; then
    printf '\n# 記憶索引（%s/MEMORY.md）\n\n' "$MEM"
    strip "$MEM/MEMORY.md" 120
  fi
  if [ -f "$MEM/handoff.md" ]; then
    printf '\n# 上一個對話留下的交接筆記（%s/handoff.md）\n\n' "$MEM"
    strip "$MEM/handoff.md" 80
  elif [ -n "$AUTO_HANDOFF" ]; then
    printf '\n# 上一個對話留下的交接筆記（%s）\n\n' "$AUTO_HANDOFF"
    strip "$AUTO_HANDOFF" 80
  fi
}

# plugin 安裝且使用者已用 route-setup 把狀態列檔案放到固定位置時，跟著 plugin 升級同步
# （內容不同才複製；目的地是符號連結就不動）
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -d "$HOME/.claude/smart-agent-route/statusline" ]; then
  for f in statusline.py compact.py; do
    src="$CLAUDE_PLUGIN_ROOT/hooks/$f"
    dst="$HOME/.claude/smart-agent-route/statusline/$f"
    if [ -f "$src" ] && [ ! -L "$dst" ] && ! cmp -s "$src" "$dst" 2>/dev/null; then
      cp "$src" "$dst" 2>/dev/null
    fi
  done
fi

n=0
if [ ! -e "$DONE" ]; then
  n=$(cat "$SHOWN" 2>/dev/null)
  case "$n" in ''|*[!0-9]*) n=0 ;; esac
fi

if [ ! -e "$DONE" ] && [ "$n" -lt 3 ]; then
  if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then cmd="/smart-agent-route:route-setup"; else cmd="/route-setup"; fi
  msg="smart-agent-route 已可直接使用。想要狀態列、自動壓縮門檻等完整設定，可輸入 ${cmd}；不設定也能正常使用，此提示最多出現 3 次。"
  # 先算出內容再寫計數，避免輸出失敗卻已計數
  json=$(body | awk -v msg="$msg" '
    function esc(s,   i, c, o) {
      o = ""
      for (i = 1; i <= length(s); i++) {
        c = substr(s, i, 1)
        if (c == "\\") o = o "\\\\"
        else if (c == "\"") o = o "\\\""
        else if (c == "\t") o = o "\\t"
        else if (c == "\r") o = o "\\r"
        else if (c in ctl) o = o ctl[c]
        else o = o c
      }
      return o
    }
    BEGIN { first = 1; for (k = 1; k < 32; k++) ctl[sprintf("%c", k)] = sprintf("\\u%04x", k) }
    { buf = buf (first ? "" : "\\n") esc($0); first = 0 }
    END {
      printf "{\"systemMessage\": \"%s\", \"hookSpecificOutput\": {\"hookEventName\": \"SessionStart\", \"additionalContext\": \"%s\\n\"}}\n", esc(msg), buf
    }') || exit 0
  [ -n "$json" ] || exit 0
  printf '%s\n' "$json"
  mkdir -p "$STATE" 2>/dev/null && printf '%s\n' "$((n + 1))" > "$SHOWN" 2>/dev/null
  exit 0
fi

body
exit 0
