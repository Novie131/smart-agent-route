#!/usr/bin/env bash
# tiered-agents 安裝腳本 — Claude Code CLI 與 VS Code 擴充共用
#
#   bash install.sh                 標準安裝(plugin 形式,保留命名空間)
#   bash install.sh --agents-only   備援安裝(直接放 agent 定義,最保險)
#   bash install.sh --uninstall     移除
#
# CLI 與 VS Code 共用 ~/.claude/,所以裝一次兩邊都生效。

set -euo pipefail

PLUGIN_NAME="tiered-agents"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCHIVE="${SCRIPT_DIR}/${PLUGIN_NAME}.plugin"

PLUGIN_DEST="${HOME}/.claude/skills/${PLUGIN_NAME}"
AGENTS_DEST="${HOME}/.claude/agents"

MODE="plugin"
[[ "${1:-}" == "--agents-only" ]] && MODE="agents"
[[ "${1:-}" == "--uninstall" ]] && MODE="uninstall"

say()  { printf '%s\n' "$*"; }
ok()   { printf '  ✔ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*"; }
die()  { printf '\n✘ %s\n' "$*" >&2; exit 1; }

# ---------- 移除 ----------
if [[ "$MODE" == "uninstall" ]]; then
  say "移除 ${PLUGIN_NAME}…"
  [[ -d "$PLUGIN_DEST" ]] && rm -rf "$PLUGIN_DEST" && ok "已移除 $PLUGIN_DEST"
  for a in worker librarian harvester; do
    [[ -f "${AGENTS_DEST}/${a}.md" ]] && rm -f "${AGENTS_DEST}/${a}.md" && ok "已移除 ${a}.md"
  done
  say ""
  say "完成。重開 Claude Code,或執行 /reload-plugins。"
  say "註:記憶資料夾沒有被動到,你的知識庫還在。"
  exit 0
fi

# ---------- 前置檢查 ----------
say "檢查環境…"

[[ -f "$ARCHIVE" ]] || die "找不到 ${PLUGIN_NAME}.plugin。請把它跟這個腳本放在同一個目錄。"
ok "找到 $(basename "$ARCHIVE")"

command -v unzip >/dev/null 2>&1 || die "需要 unzip,但系統上找不到。"

if command -v claude >/dev/null 2>&1; then
  ok "Claude Code $(claude --version 2>/dev/null | head -1)"
else
  warn "PATH 裡找不到 claude 指令。檔案仍會照裝,但請確認 Claude Code 已安裝。"
fi

# ---------- 解壓到暫存並驗證 ----------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

unzip -q "$ARCHIVE" -d "$TMP" || die "解壓失敗,壓縮檔可能損毀。"

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
  say "註:此模式下 agent 名稱不帶命名空間(worker 而非 tiered-agents:worker)。"
else
  say "安裝 plugin…"
  rm -rf "$PLUGIN_DEST"
  mkdir -p "$PLUGIN_DEST"
  cp -R "${TMP}/." "$PLUGIN_DEST/"
  ok "已安裝到 ~/.claude/skills/${PLUGIN_NAME}/"
  ok "此位置會自動載入,不需要 marketplace"
fi

# ---------- 後續步驟 ----------
cat <<'EOF'

──────────────────────────────────────────
安裝完成。接下來三件事:

1. 重開 Claude Code,或在現有 session 執行:
     /reload-plugins

2. 驗證 agent 有載入:
     /context
   在 Custom Agents 區塊應看到 worker、librarian、harvester。
   沒看到的話改跑:  bash install.sh --agents-only

3. 把主對話設成 Opus(plugin 不會自動改這個):
     /model opus

──────────────────────────────────────────
記憶庫還沒建的話:

  mkdir -p <你的資料夾>/claude-memory/{topics,kb}

再把 plugin 裡的 templates/MEMORY.md 複製進去當起點。
CLI 在該資料夾底下開 session,Cowork 則每次把它連接進來。

詳細說明見 plugin 內的 INSTALL.md 與 README.md。
EOF
