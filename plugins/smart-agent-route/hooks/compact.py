"""自動壓縮點的共用小模組（statusline.py 與 context-check.py 共用）。

Claude Code 的 settings.json 鍵 autoCompactWindow 是「壓縮視窗」，
實際壓縮點約為 autoCompactWindow 扣掉 /context 顯示的 Autocompact buffer。
buffer 預設 33000（本機實測值，用 /context 確認），可用環境變數 CONTEXT_AUTOCOMPACT_BUFFER 覆寫。
"""
import json, os

DEFAULT_BUFFER = 33000


def compact_point():
    """回傳預估的自動壓縮點（tokens）；沒設定、讀不到、JSON 壞掉都回傳 None，不丟例外。"""
    try:
        with open(os.path.expanduser("~/.claude/settings.json")) as f:
            window = json.load(f).get("autoCompactWindow")
        if isinstance(window, bool) or not isinstance(window, int):
            return None
        buffer = int(os.environ.get("CONTEXT_AUTOCOMPACT_BUFFER", DEFAULT_BUFFER))
        return window - buffer
    except Exception:
        return None
