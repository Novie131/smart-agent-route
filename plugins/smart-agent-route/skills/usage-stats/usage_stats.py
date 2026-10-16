#!/usr/bin/env python3
"""統計 Claude Code 對話紀錄的 context 用量與子 agent 使用比例，用於優化前後比較。

用法：python3 usage_stats.py [--since YYYY-MM-DD] [--until YYYY-MM-DD]
                             [--project 子字串] [--root 路徑] [--threshold N]
"""
import argparse
import glob
import json
import os
from collections import defaultdict


def env_threshold():
    try:
        return int(os.environ.get("CONTEXT_REMIND_TOKENS", ""))
    except ValueError:
        return 120000


def num(u, key):
    v = u.get(key, 0)
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else 0


def agent_type(path):
    meta = path[:-len(".jsonl")] + ".meta.json"
    try:
        with open(meta, encoding="utf-8", errors="ignore") as fh:
            t = json.load(fh).get("agentType")
        return t if isinstance(t, str) and t else "(未知)"
    except Exception:
        return "(未知)"


def pct(x):
    return f"{x:.0%}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="0000-00-00")
    ap.add_argument("--until", default="9999-99-99")
    ap.add_argument("--project", default="")
    ap.add_argument("--root", default="~/.claude/projects")
    ap.add_argument("--threshold", type=int, default=None)
    args = ap.parse_args()
    threshold = args.threshold if args.threshold is not None else env_threshold()
    root = os.path.abspath(os.path.expanduser(args.root))

    seen, ctx = set(), []
    by = defaultdict(lambda: {"calls": 0, "cache_r": 0, "cache_w": 0, "out": 0})
    by_type = defaultdict(lambda: {"calls": 0, "out": 0})
    main_sessions, sessions_with_sub = set(), set()
    main_calls = sub_calls = 0

    for f in sorted(glob.glob(os.path.join(root, "**", "*.jsonl"), recursive=True)):
        rel = os.path.relpath(f, root).split(os.sep)
        if args.project and args.project not in rel[0]:
            continue
        in_sub_dir = "subagents" in rel[:-1]
        atype = None
        try:
            fh = open(f, encoding="utf-8", errors="ignore")
        except OSError:
            continue
        with fh:
            try:
                lines = list(fh)
            except Exception:
                continue
        for line in lines:
            try:
                d = json.loads(line)
                m = d.get("message")
                if d.get("type") != "assistant" or not isinstance(m, dict):
                    continue
                u = m.get("usage")
                if not isinstance(u, dict) or not u:
                    continue
                ts = d.get("timestamp")
                if not isinstance(ts, str) or not (args.since <= ts[:10] <= args.until):
                    continue
                key = (m.get("id"), d.get("requestId"))
                if key in seen:
                    continue
                seen.add(key)
                is_sub = bool(d.get("isSidechain")) or in_sub_dir
                model = str(m.get("model", "?"))
                cr, cw = num(u, "cache_read_input_tokens"), num(u, "cache_creation_input_tokens")
                out = num(u, "output_tokens")
                b = by[f"{model} | {'sub' if is_sub else 'main'}"]
                b["calls"] += 1
                b["cache_r"] += cr
                b["cache_w"] += cw
                b["out"] += out
                if is_sub:
                    sub_calls += 1
                    if atype is None:
                        atype = agent_type(f) if f.endswith(".jsonl") else "(未知)"
                    t = by_type[(atype, model)]
                    t["calls"] += 1
                    t["out"] += out
                    if in_sub_dir:
                        sess = rel[rel.index("subagents") - 1]
                    else:
                        sess = d.get("sessionId") or os.path.basename(f)[:-6]
                    sessions_with_sub.add((rel[0], sess))
                else:
                    main_calls += 1
                    ctx.append(num(u, "input_tokens") + cw + cr)
                    main_sessions.add((rel[0], os.path.basename(f)[:-6]))
            except Exception:
                continue

    print(f"期間：{args.since} ~ {args.until}" + (f"　專案：{args.project}" if args.project else ""))
    if not by:
        print("沒有符合條件的用量紀錄。")
        return
    print(f"\n{'模型 | main/sub':40} {'calls':>6} {'cache_read':>13} {'cache_write':>12} {'output':>10}")
    for k, v in sorted(by.items(), key=lambda kv: -kv[1]["calls"]):
        print(f"{k:40} {v['calls']:>6} {v['cache_r']:>13,} {v['cache_w']:>12,} {v['out']:>10,}")

    if ctx:
        ctx.sort()
        n = len(ctx)
        over = sum(x > threshold for x in ctx)
        med = ctx[n // 2] if n % 2 else (ctx[n // 2 - 1] + ctx[n // 2]) // 2
        print(f"\n主對話每次呼叫的 context（{n} 次）：中位數 {med:,}　p90 {ctx[min(int(n * .9), n - 1)]:,}　最大 {ctx[-1]:,}")
        print(f"超過門檻 {threshold:,} 的呼叫比例：{pct(over / n)}（{over}/{n}）")
    else:
        print("\n沒有主對話呼叫紀錄。")

    total = main_calls + sub_calls
    print(f"\n子 agent 呼叫比例：{sub_calls}/{total}（{pct(sub_calls / total)}）")
    ms = {s for s in main_sessions}
    used = len(sessions_with_sub & (ms | sessions_with_sub))
    denom = len(ms | sessions_with_sub)
    if denom:
        print(f"有派過子 agent 的主對話 session：{used}/{denom}（{pct(used / denom)}）")

    if by_type:
        print(f"\n{'agent 類型':36} {'模型':28} {'calls':>6} {'output':>10}")
        for (a, mdl), v in sorted(by_type.items(), key=lambda kv: (kv[0][0], -kv[1]["calls"])):
            print(f"{a:36} {mdl:28} {v['calls']:>6} {v['out']:>10,}")
        # 2026-10-16 實測：子 agent 紀錄的 usage 是串流開頭的值（每次只有個位數到幾十），主對話紀錄則是最終值
        print("註：子 agent 的 output 取自串流開頭，嚴重低估，只能看呼叫次數，不能拿來比成本。")


if __name__ == "__main__":
    main()
