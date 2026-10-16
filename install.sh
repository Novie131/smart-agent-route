#!/usr/bin/env bash
# smart-agent-route 安裝腳本 — Claude Code CLI 與 VS Code 擴充共用
#
#   bash install.sh                 複製安裝(agent、skill、hook 複製到 ~/.claude/,名稱不帶前綴;重跑即更新)
#   bash install.sh --agents-only   只複製 agent(hook 與 skill 不會生效)
#   bash install.sh --link          用符號連結裝 agent、skill、hook(改 repo 立即生效,適合自己維護的人)
#   bash install.sh --uninstall     移除(依安裝清單,不動你自己的檔案)
#   bash install.sh --with-explore  另外安裝 Haiku 版 Explore 到 ~/.claude/agents/(plugin 蓋不掉內建版)
#
# 複製安裝的項目記在 ~/.claude/.smart-agent-route-installed(每行一個相對 ~/.claude 的路徑)。
# 有 smart-agent-route.plugin 就從它安裝;沒有(例如直接 clone repo)就用 plugins/smart-agent-route/。
#
# CLI 與 VS Code 共用 ~/.claude/,所以裝一次兩邊都生效。

set -euo pipefail

PLUGIN_NAME="smart-agent-route"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCHIVE="${SCRIPT_DIR}/${PLUGIN_NAME}.plugin"
SRC_DIR="${SCRIPT_DIR}/plugins/${PLUGIN_NAME}"

PLUGIN_DEST="${HOME}/.claude/skills/${PLUGIN_NAME}"
LEGACY_DEST="${HOME}/.claude/skills/tiered-agents"   # 0.7.0 以前的名稱
AGENTS_DEST="${HOME}/.claude/agents"
SKILLS_DEST="${HOME}/.claude/skills"
HOOKS_LINK="${HOME}/.claude/hooks/${PLUGIN_NAME}"
MANIFEST="${HOME}/.claude/.smart-agent-route-installed"

MODE="copy"
WITH_EXPLORE=0
for arg in "$@"; do
  case "$arg" in
    --agents-only)  MODE="agents" ;;
    --link)         MODE="link" ;;
    --uninstall)    MODE="uninstall" ;;
    --with-explore) WITH_EXPLORE=1 ;;
    *) printf '未知參數:%s\n' "$arg" >&2; exit 1 ;;
  esac
done

say()  { printf '%s\n' "$*"; }
ok()   { printf '  ✔ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*"; }
die()  { printf '\n✘ %s\n' "$*" >&2; exit 1; }

# ---------- 移除 ----------
if [[ "$MODE" == "uninstall" ]]; then
  say "移除 ${PLUGIN_NAME}…"
  # 依清單移除複製安裝的項目。只接受 agents/、skills/、hooks/ 底下的單層名稱,
  # 清單被改壞(例如出現 . 或空行)也不會刪到 ~/.claude 本身
  if [[ -f "$MANIFEST" ]]; then
    while IFS= read -r rel || [[ -n "$rel" ]]; do
      [[ "$rel" =~ ^(agents|skills|hooks)/[A-Za-z0-9][A-Za-z0-9._-]*$ && "$rel" != *..* ]] || continue
      t="${HOME}/.claude/${rel}"
      if [[ -L "$t" ]]; then
        warn "~/.claude/${rel} 現在是符號連結,不在這裡處理(連到本 repo 的連結會在下面移除)"
      elif [[ -e "$t" ]]; then
        rm -rf "$t" && ok "已移除 ~/.claude/${rel}"
      fi
    done < "$MANIFEST"
    rm -f "$MANIFEST" && ok "已移除安裝清單"
  fi
  [[ -d "$PLUGIN_DEST" ]] && rm -rf "$PLUGIN_DEST" && ok "已移除 $PLUGIN_DEST"
  [[ -d "$LEGACY_DEST" ]] && rm -rf "$LEGACY_DEST" && ok "已移除舊版 $LEGACY_DEST"
  # agent(給沒有清單的舊安裝用):只移除連到本 repo 的連結,或跟 repo 內容相同的複本;
  # 內容不同的同名檔可能是使用者自己寫的,保留並提醒
  for a in worker worker-hard bulk librarian harvester; do
    f="${AGENTS_DEST}/${a}.md"
    if [[ -L "$f" && "$(readlink "$f")" == "${SRC_DIR}/"* ]] || cmp -s "$f" "${SRC_DIR}/agents/${a}.md"; then
      rm -f "$f" && ok "已移除 ${a}.md"
    elif [[ -e "$f" ]]; then
      warn "~/.claude/agents/${a}.md 跟本 repo 的版本不同,可能是你自己的檔案,沒有移除"
    fi
  done
  # --link 裝的 skill 與 hook:只移除連到本 repo 的符號連結,不碰同名的其他檔案
  for d in "${SKILLS_DEST}"/* "$HOOKS_LINK"; do
    if [[ -L "$d" && "$(readlink "$d")" == "${SRC_DIR}/"* ]]; then
      rm -f "$d" && ok "已移除連結 ${d/#$HOME/~}"
    fi
  done
  say ""
  say "完成。重開 Claude Code。若你有把 hook 片段貼進 settings.json,記得手動移除。"
  say "註:記憶資料夾沒有被動到,你的知識庫還在。"
  say "註:~/.claude/agents/Explore.md 不會自動移除(可能是你自己寫的),要移除請手動刪。"
  exit 0
fi

# ---------- 前置檢查 ----------
say "檢查環境…"

if [[ -f "$ARCHIVE" ]]; then
  ok "找到 $(basename "$ARCHIVE")"
  command -v unzip >/dev/null 2>&1 || die "需要 unzip,但系統上找不到。"
elif [[ -d "$SRC_DIR" ]]; then
  ok "沒有 .plugin 封包,改用 repo 內的 plugins/${PLUGIN_NAME}/"
else
  die "找不到 ${PLUGIN_NAME}.plugin,也找不到 plugins/${PLUGIN_NAME}/。請在 repo 根目錄執行,或把 .plugin 放在腳本旁邊。"
fi

command -v python3 >/dev/null 2>&1 || warn "找不到 python3:context 長度提醒會安靜停用,其餘功能正常。"

if command -v claude >/dev/null 2>&1; then
  ok "Claude Code $(claude --version 2>/dev/null | head -1)"
else
  warn "PATH 裡找不到 claude 指令。檔案仍會照裝,但請確認 Claude Code 已安裝。"
fi

# ---------- hook 設定片段 ----------
print_hook_snippet() {
  cat <<'MSG'
hook 不會自動啟用:本腳本不改你的 settings.json。要啟用請把下面這段
合併進 ~/.claude/settings.json 的 "hooks"(已有同類 hook 時先移除舊的,以免重複提醒):

  "SessionStart": [
    { "matcher": "startup|clear|compact",
      "hooks": [{ "type": "command", "command": "sh ~/.claude/hooks/smart-agent-route/session-start.sh" }] }
  ],
  "UserPromptSubmit": [
    { "hooks": [{ "type": "command",
        "command": "sh ~/.claude/hooks/smart-agent-route/run-python.sh ~/.claude/hooks/smart-agent-route/context-check.py" }] }
  ]
MSG
}

# ---------- 清掉舊版錯誤的安裝位置 ----------
if [[ -e "$PLUGIN_DEST" || -L "$PLUGIN_DEST" ]]; then
  rm -rf "$PLUGIN_DEST"
  ok "舊版安裝位置 ~/.claude/skills/${PLUGIN_NAME}/ 不會被載入,已移除"
fi
if [[ -d "$LEGACY_DEST" ]]; then
  warn "偵測到舊版 tiered-agents($LEGACY_DEST),兩者並存時 agent 會重複出現。"
  warn "請移除舊版:rm -rf ~/.claude/skills/tiered-agents"
fi

# ---------- 符號連結 ----------
# 連到 repo 裡的檔案,改 repo 立即生效。已存在的檔案一律不覆蓋,避免蓋掉使用者自己寫的同名檔。
if [[ "$MODE" == "link" ]]; then
  [[ -d "$SRC_DIR" ]] || die "--link 需要 repo 內的 plugins/${PLUGIN_NAME}/(.plugin 封包不能連結)"
  SKIPPED=0
  link_one() {  # $1 = repo 內的來源, $2 = ~/.claude 底下的目的地
    local shown="${2/#$HOME/~}"
    if [[ -L "$2" && "$(readlink "$2")" == "$1" ]]; then
      ok "${shown}(已連結)"
    elif [[ -e "$2" || -L "$2" ]]; then
      warn "${shown} 已存在,不覆蓋。要改用連結請先備份並刪除,再重跑。"
      SKIPPED=1
    else
      ln -s "$1" "$2" && ok "${shown} → ${1/#$HOME/~}"
    fi
  }
  say ""
  say "建立符號連結…"
  mkdir -p "$AGENTS_DEST" "$SKILLS_DEST" "$(dirname "$HOOKS_LINK")"
  for f in "${SRC_DIR}"/agents/*.md; do link_one "$f" "${AGENTS_DEST}/$(basename "$f")"; done
  for d in "${SRC_DIR}"/skills/*/; do d="${d%/}"; link_one "$d" "${SKILLS_DEST}/$(basename "$d")"; done
  link_one "${SRC_DIR}/hooks" "$HOOKS_LINK"
  if [[ "$SKIPPED" == 1 ]]; then warn "有項目沒連結(見上方),那些項目仍是你原本的檔案。"; fi
  say ""
  say "──────────────────────────────────────────"
  say "連結完成。此模式名稱不帶命名空間(worker、/handoff)。"
  say ""
  print_hook_snippet
  say ""
  say "之後重開 Claude Code,用 /agents 與 /hooks 確認。repo 搬家後連結會失效,重跑一次即可。"
  say "──────────────────────────────────────────"
  exit 0
fi

# ---------- 解壓到暫存並驗證 ----------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [[ -f "$ARCHIVE" ]]; then
  unzip -q "$ARCHIVE" -d "$TMP" || die "解壓失敗,壓縮檔可能損毀。"
else
  cp -R "${SRC_DIR}/." "$TMP/"
fi

[[ -f "${TMP}/.claude-plugin/plugin.json" ]] || die "壓縮檔內容不正確:缺少 .claude-plugin/plugin.json"
[[ -d "${TMP}/agents" ]] || die "壓縮檔內容不正確:缺少 agents/ 目錄"

VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${TMP}/.claude-plugin/plugin.json" | head -1)"
ok "封包驗證通過(版本 ${VERSION:-未知})"

AGENT_COUNT="$(find "${TMP}/agents" -name '*.md' | wc -l | tr -d ' ')"
ok "包含 ${AGENT_COUNT} 個 agent"

# ---------- 安裝 ----------
# 逐項規則:目的地不存在→複製;已在清單→先刪再複製(更新);符號連結→不動;
# 不在清單但內容與來源相同→視為我們的;其餘是使用者自己的檔案,不覆蓋。
SKIPPED=0
touch_manifest() { mkdir -p "$(dirname "$MANIFEST")"; touch "$MANIFEST"; }
in_manifest()    { grep -qxF -- "$1" "$MANIFEST"; }
record()         { if ! in_manifest "$1"; then printf '%s\n' "$1" >> "$MANIFEST"; fi; }

install_one() {  # $1 = 暫存區內的來源, $2 = 相對 ~/.claude 的目的地
  local src="$1" rel="$2" dest="${HOME}/.claude/$2"
  if [[ -L "$dest" ]]; then
    warn "~/.claude/${rel} 是符號連結,不動(可能是 --link 裝的;要切換成複製請先 --uninstall)"
    SKIPPED=1
  elif [[ ! -e "$dest" ]]; then
    mkdir -p "$(dirname "$dest")"
    cp -R "$src" "$dest"
    record "$rel"
    ok "~/.claude/${rel}"
  elif in_manifest "$rel"; then
    rm -rf "$dest"
    cp -R "$src" "$dest"
    ok "~/.claude/${rel}(已更新)"
  elif diff -rq "$src" "$dest" >/dev/null 2>&1; then
    record "$rel"
    ok "~/.claude/${rel}(內容相同,納入清單)"
  else
    warn "~/.claude/${rel} 已存在且內容不同,可能是你自己的檔案,不覆蓋。"
    SKIPPED=1
  fi
}

say ""
touch_manifest
if [[ "$MODE" == "agents" ]]; then
  say "只安裝 agent 定義…"
else
  say "複製安裝 agent、skill、hook…"
  [[ -d "${TMP}/skills" ]] || die "壓縮檔內容不正確:缺少 skills/ 目錄"
  [[ -d "${TMP}/hooks" ]]  || die "壓縮檔內容不正確:缺少 hooks/ 目錄"
fi
for f in "${TMP}"/agents/*.md; do install_one "$f" "agents/$(basename "$f")"; done
if [[ "$MODE" != "agents" ]]; then
  for d in "${TMP}"/skills/*/; do d="${d%/}"; install_one "$d" "skills/$(basename "$d")"; done
  install_one "${TMP}/hooks" "hooks/${PLUGIN_NAME}"
fi
if [[ "$MODE" == "agents" ]]; then
  say ""
  say "註:agent 名稱不帶命名空間(worker 而非 smart-agent-route:worker)。"
  warn "此模式只裝 agent:hook(context 提醒、session 開始帶入記憶)與 skill(handoff、research)不會生效。"
fi

if [[ "$WITH_EXPLORE" == 1 ]]; then
  if [[ -f "${AGENTS_DEST}/Explore.md" ]]; then
    warn "~/.claude/agents/Explore.md 已存在,不覆蓋。要換成 plugin 的版本請先自行備份並刪除。"
  else
    mkdir -p "$AGENTS_DEST"
    cp "${TMP}/templates/Explore.md" "${AGENTS_DEST}/Explore.md"
    ok "Explore.md → ~/.claude/agents/(搜尋程式碼改用 Haiku)"
  fi
fi

# ---------- 後續步驟 ----------
if [[ "$SKIPPED" == 1 ]]; then
  say ""
  warn "有項目被略過(見上方),那些項目仍是你原本的檔案。"
fi

say ""
say "──────────────────────────────────────────"
if [[ "$MODE" == "agents" ]]; then
  say "安裝完成。重開 Claude Code,用 /agents 確認 worker、worker-hard、bulk、librarian、harvester 都在。"
  say "──────────────────────────────────────────"
  exit 0
fi
say "安裝完成。名稱不帶命名空間(worker、/handoff)。接下來:"
say ""
say "1. 重開 Claude Code,用 /agents 確認 worker、worker-hard、bulk、librarian、harvester 都在。"
say ""
say "2. hook 設定(見下):"
say ""
print_hook_snippet
say ""
say "3. 把主對話設成 Opus(不會自動改這個):"
say "     /model opus"
say ""
say "更新:之後重跑 bash install.sh 即可(清單內的項目會被覆蓋更新)。"
cat <<'EOF'

──────────────────────────────────────────
記憶庫還沒建的話:

  mkdir -p <你的資料夾>/claude-memory/{topics,kb,web}

再把 plugin 裡的 templates/MEMORY.md 複製進去當起點。
CLI 在該資料夾底下開 session,Cowork 則每次把它連接進來。

詳細說明見 plugin 內的 INSTALL.md 與 README.md。
EOF
