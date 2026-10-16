import json
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "plugins", "smart-agent-route", "skills", "usage-stats", "usage_stats.py")


def rec(mid, rid, ctx, model="claude-opus-5-5", ts="2026-10-10T01:00:00Z", side=False, out=10):
    return json.dumps({
        "type": "assistant", "timestamp": ts, "requestId": rid, "isSidechain": side,
        "message": {"id": mid, "model": model,
                    "usage": {"input_tokens": 0, "cache_creation_input_tokens": 0,
                              "cache_read_input_tokens": ctx, "output_tokens": out}},
    })


def write(path, lines):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")


class UsageStatsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        p = os.path.join(self.root, "-proj-alpha")
        write(os.path.join(p, "s1.jsonl"), [
            rec("m1", "r1", 100000),
            rec("m1", "r1", 100000),  # 重複
            "{壞行",
            json.dumps({"type": "assistant", "message": {"id": "x"}}),  # 缺欄位
            rec("m2", "r2", 200000),
            rec("m3", "r3", 50000, ts="2026-09-01T00:00:00Z"),
        ])
        write(os.path.join(p, "s1", "subagents", "agent-x.jsonl"),
              [rec("s1", "q1", 1000, model="claude-opus-5-5", side=True),
               rec("s2", "q2", 1000, model="claude-haiku-5-5", side=True)])
        with open(os.path.join(p, "s1", "subagents", "agent-x.meta.json"), "w") as f:
            json.dump({"agentType": "smart-agent-route:worker"}, f)
        write(os.path.join(p, "s1", "subagents", "agent-y.jsonl"),
              [rec("s3", "q3", 1000, model="claude-haiku-5-5", side=True)])
        write(os.path.join(p, "s2.jsonl"), [rec("m4", "r4", 300000)])
        write(os.path.join(self.root, "-proj-beta", "s3.jsonl"), [rec("m5", "r5", 10000)])

    def tearDown(self):
        self.tmp.cleanup()

    def run_script(self, *args, root=None):
        r = subprocess.run([sys.executable, SCRIPT, "--root", root or self.root, *args],
                           capture_output=True, text=True,
                           stdin=subprocess.DEVNULL, timeout=60, env=self.clean_env())
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout

    @staticmethod
    def clean_env():
        env = os.environ.copy()
        env.pop("CONTEXT_REMIND_TOKENS", None)
        return env

    def test_dedup_median_threshold(self):
        out = self.run_script("--project", "alpha", "--since", "2026-10-01")
        # main: 100000、200000、300000（m1 去重、m3 被 since 排除）
        self.assertIn("（3 次）", out)
        self.assertIn("中位數 200,000", out)
        self.assertIn("（2/3）", out)

    def test_default_threshold_100k(self):
        out = self.run_script("--project", "alpha", "--since", "2026-10-01")
        self.assertIn("超過門檻 100,000 的呼叫比例", out)

    def test_threshold_option(self):
        out = self.run_script("--project", "alpha", "--since", "2026-10-01", "--threshold", "250000")
        self.assertIn("（1/3）", out)

    def test_agent_type_split(self):
        out = self.run_script("--project", "alpha")
        lines = out.splitlines()
        self.assertTrue(any("smart-agent-route:worker" in l and "claude-opus-5-5" in l for l in lines))
        self.assertTrue(any("smart-agent-route:worker" in l and "claude-haiku-5-5" in l for l in lines))
        self.assertTrue(any("(未知)" in l and "claude-haiku-5-5" in l for l in lines))
        self.assertIn("子 agent 呼叫比例：3/7", out)
        self.assertIn("1/2", out)  # 有派子 agent 的 session：s1 / (s1, s2)

    def test_since_until_filter(self):
        out = self.run_script("--project", "alpha", "--since", "2026-10-01")
        self.assertNotIn("50,000", out)
        out2 = self.run_script("--project", "alpha", "--until", "2026-09-30")
        self.assertIn("（1 次）", out2)

    def test_project_filter(self):
        out = self.run_script("--project", "beta")
        self.assertIn("（1 次）", out)
        self.assertNotIn("agent 類型", out)

    def test_empty_dir(self):
        with tempfile.TemporaryDirectory() as empty:
            out = self.run_script(root=empty)
            self.assertIn("沒有符合條件", out)


if __name__ == "__main__":
    unittest.main()
