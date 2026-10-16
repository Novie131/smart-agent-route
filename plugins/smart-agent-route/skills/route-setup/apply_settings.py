#!/usr/bin/env python3
"""安全地把 statusLine 與 autoCompactWindow 寫進 settings.json（只用標準函式庫）。

硬性規則：
- 只碰 statusLine 與 autoCompactWindow 兩個鍵；絕不碰 permissions、hooks 或其他鍵。
- 已有值就不覆蓋：印出現值，並以結束碼 3 回報「已存在」（沒有衝突的另一個鍵仍會寫入）。
- JSON 解析失敗或最外層不是物件：不寫、不備份，結束碼 2。
- 寫入前備份為 settings.json.bak-<YYYYmmdd-HHMMSS>；整份寫回用暫存檔 + os.replace。
- 檔案不存在就建立（不需要備份）。

結束碼：0 成功（或 --status）、2 settings 壞掉或無法寫入、3 有鍵已存在而未覆蓋。
"""
import argparse
import json
import os
import sys
import tempfile
import time

KEYS = ("statusLine", "autoCompactWindow")


def load(path):
    """回傳 (資料, 檔案是否存在)；壞掉則拋 ValueError。"""
    if not os.path.exists(path):
        return {}, False
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        raise ValueError(str(e).replace("\n", " "))
    if not isinstance(data, dict):
        raise ValueError("最外層不是 JSON 物件")
    return data, True


def model_overrides(data):
    """modelSettings 裡有逐模型覆蓋 autoCompact 類鍵的模型清單。"""
    ms = data.get("modelSettings")
    found = {}
    if isinstance(ms, dict):
        for model, conf in ms.items():
            if isinstance(conf, dict):
                keys = [k for k in conf if "autocompact" in k.lower()]
                if keys:
                    found[model] = keys
    return found


def status(data):
    overrides = model_overrides(data)
    return {
        "statusLine": data.get("statusLine"),
        "autoCompactWindow": data.get("autoCompactWindow"),
        "modelSettingsOverridesAutoCompact": bool(overrides),
        "modelSettingsOverrides": overrides,
        "model": data.get("model"),
    }


def write_atomic(path, data):
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".settings-", suffix=".tmp", dir=d)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
        if os.path.exists(path):
            os.chmod(tmp, os.stat(path).st_mode & 0o777)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--settings", default=os.path.expanduser("~/.claude/settings.json"))
    ap.add_argument("--status", action="store_true", help="印出目前相關設定（JSON）")
    ap.add_argument("--set-statusline", metavar="CMD")
    ap.add_argument("--set-autocompact", metavar="N", type=int)
    ap.add_argument("--dry-run", action="store_true", help="只顯示會做什麼，不寫、不備份")
    args = ap.parse_args(argv)
    path = args.settings

    try:
        data, existed = load(path)
    except ValueError as e:
        print(f"settings 無法解析（{e}），不修改：{path}", file=sys.stderr)
        return 2

    if args.status:
        print(json.dumps(status(data), indent=2, ensure_ascii=False))

    wanted = {}
    if args.set_statusline is not None:
        wanted["statusLine"] = {"type": "command", "command": args.set_statusline}
    if args.set_autocompact is not None:
        wanted["autoCompactWindow"] = args.set_autocompact

    if not wanted:
        if not args.status:
            ap.print_usage(sys.stderr)
            return 2
        return 0

    exists_code = 0
    to_write = {}
    for key, value in wanted.items():
        if key in data:
            print(f"{key} 已存在，不覆蓋，現值：{json.dumps(data[key], ensure_ascii=False)}")
            exists_code = 3
        else:
            to_write[key] = value

    if to_write:
        names = "、".join(to_write)
        if args.dry_run:
            print(f"[dry-run] 會寫入 {names}：{json.dumps(to_write, ensure_ascii=False)}"
                  f"{'' if existed else '（檔案不存在，會建立）'}")
        else:
            try:
                bak = None
                if existed:
                    bak = f"{path}.bak-{time.strftime('%Y%m%d-%H%M%S')}"
                    with open(path, "rb") as src, open(bak, "wb") as dst:
                        dst.write(src.read())
                data.update(to_write)
                write_atomic(path, data)
            except OSError as e:
                print(f"寫入失敗（{e}）", file=sys.stderr)
                return 2
            print(f"已寫入 {names}")
            if bak:
                print(f"備份：{bak}（還原：把它改回 {os.path.basename(path)}）")
    return exists_code


if __name__ == "__main__":
    sys.exit(main())
