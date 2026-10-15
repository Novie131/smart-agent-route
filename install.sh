#!/usr/bin/env bash
# smart-agent-route 安裝腳本 — Claude Code CLI 與 VS Code 擴充共用
#
#   bash install.sh                 標準安裝(plugin 形式,保留命名空間)
#   bash install.sh --agents-only   備援安裝(直接放 agent 定義,最保險)
#   bash install.sh --uninstall     移除
#   bash install.sh --with-explore  另外安裝 Haiku 版 Explore 到 ~/.claude/agents/(plugin 蓋不掉內建版)
#
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

MODE="plugin"
WITH_EXPLORE=0
for arg in "$@"; do
  case "$arg" in
    --agents-only)  MODE="agents" ;;
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
  [[ -d "$PLUGIN_DEST" ]] && rm -rf "$PLUGIN_DEST" && ok "已移除 $PLUGIN_DEST"
  [[ -d "$LEGACY_DEST" ]] && rm -rf "$LEGACY_DEST" && ok "已移除舊版 $LEGACY_DEST"
  for a in worker worker-hard bulk librarian harvester; do
    [[ -f "${AGENTS_DEST}/${a}.md" ]] && rm -f "${AGENTS_DEST}/${a}.md" && ok "已移除 ${a}.md"
  done
  say ""
  say "完成。重開 Claude Code,或執行 /reload-plugins。"
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
say ""
if [[ "$MODE" == "agents" ]]; then
  say "備援模式:直接安裝 agent 定義…"
  mkdir -p "$AGENTS_DEST"
  for f in "${TMP}"/agents/*.md; do
    cp "$f" "${AGENTS_DEST}/"
    ok "$(basename "$f") → ~/.claude/agents/"
  done
  say ""
  say "註:此模式下 agent 名稱不帶命名空間(worker 而非 smart-agent-route:worker)。"
  warn "此模式只裝 agent:hook(context 提醒、session 開始帶入記憶)與 skill(handoff、research)不會生效。"
else
  say "安裝 plugin…"
  rm -rf "$PLUGIN_DEST"
  mkdir -p "$PLUGIN_DEST"
  cp -R "${TMP}/." "$PLUGIN_DEST/"
  ok "已安裝到 ~/.claude/skills/${PLUGIN_NAME}/"
  ok "此位置會自動載入,不需要 marketplace"
  if [[ -d "$LEGACY_DEST" ]]; then
    warn "偵測到舊版 tiered-agents($LEGACY_DEST),兩者並存時 agent 會重複出現。"
    warn "請移除舊版:rm -rf ~/.claude/skills/tiered-agents"
  fi
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
cat <<'EOF'

──────────────────────────────────────────
安裝完成。接下來三件事:

1. 重開 Claude Code,或在現有 session 執行:
     /reload-plugins

2. 驗證 agent 有載入:
     /context
   在 Custom Agents 區塊應看到 worker、worker-hard、bulk、librarian、harvester。
   沒看到的話改跑:  bash install.sh --agents-only

3. 把主對話設成 Opus(plugin 不會自動改這個):
     /model opus

──────────────────────────────────────────
記憶庫還沒建的話:

  mkdir -p <你的資料夾>/claude-memory/{topics,kb,web}

再把 plugin 裡的 templates/MEMORY.md 複製進去當起點。
CLI 在該資料夾底下開 session,Cowork 則每次把它連接進來。

詳細說明見 plugin 內的 INSTALL.md 與 README.md。
EOF
