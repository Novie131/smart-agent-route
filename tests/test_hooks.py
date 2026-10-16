import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOOKS = ROOT / "plugins" / "smart-agent-route" / "hooks"
CONTEXT_CHECK = HOOKS / "context-check.py"
SESSION_START = HOOKS / "session-start.sh"
GUIDE = HOOKS / "guide.md"
STATUSLINE = HOOKS / "statusline.py"
COMPACT = HOOKS / "compact.py"


class ContextCheckTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)
        self.data = self.tmp / "data"
        self.home = self.tmp / "home"
        self.home.mkdir()

    def env(self):
        env = os.environ.copy()
        env["HOME"] = str(self.home)
        env["CLAUDE_PLUGIN_DATA"] = str(self.data)
        env["CONTEXT_REMIND_TOKENS"] = "1000"
        return env

    def transcript(self, name, sizes):
        p = self.tmp / name
        with open(p, "w") as f:
            for i, n in enumerate(sizes):
                f.write(json.dumps({
                    "type": "assistant",
                    "message": {"id": f"msg_{name}_{i}",
                                "usage": {"input_tokens": n}},
                }) + "\n")
        return p

    def run_hook(self, stdin):
        return subprocess.run(
            [sys.executable, str(CONTEXT_CHECK)], input=stdin, text=True,
            capture_output=True, env=self.env(), timeout=30)

    def run_payload(self, path):
        return self.run_hook(json.dumps({"transcript_path": str(path)}))

    def test_below_threshold_silent(self):
        r = self.run_payload(self.transcript("a.jsonl", [100, 500]))
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout, "")

    def test_crossing_threshold_reminds(self):
        r = self.run_payload(self.transcript("b.jsonl", [100, 5000]))
        self.assertEqual(r.returncode, 0)
        out = json.loads(r.stdout)
        self.assertEqual(out["hookSpecificOutput"]["hookEventName"], "UserPromptSubmit")
        self.assertIn("additionalContext", out["hookSpecificOutput"])

    def test_no_repeat_in_same_session(self):
        p = self.transcript("c.jsonl", [100, 5000])
        self.assertNotEqual(self.run_payload(p).stdout, "")
        self.assertEqual(self.run_payload(p).stdout, "")

    def test_state_written_only_to_temp(self):
        self.run_payload(self.transcript("d.jsonl", [5000]))
        self.assertTrue((self.data / ".context-check-state.json").exists())

    def write_settings(self, text):
        (self.home / ".claude").mkdir(exist_ok=True)
        (self.home / ".claude" / "settings.json").write_text(text)

    def test_reminder_with_compact_point(self):
        self.write_settings(json.dumps({"autoCompactWindow": 183000}))
        out = json.loads(self.run_payload(self.transcript("e.jsonl", [100, 5000])).stdout)
        text = out["hookSpecificOutput"]["additionalContext"]
        self.assertIn("約 150k 會自動壓縮，時機和重點都不是自己選的。", text)
        self.assertNotIn("接近 context 上限", text)

    def test_reminder_without_compact_point(self):
        out = json.loads(self.run_payload(self.transcript("f.jsonl", [100, 5000])).stdout)
        text = out["hookSpecificOutput"]["additionalContext"]
        self.assertTrue(text.endswith("並說明不處理的話，接近 context 上限時會自動壓縮，時機和重點都不是自己選的。"))

    def test_bad_input_is_quiet(self):
        cases = [
            "not json",
            "",
            json.dumps({"transcript_path": str(self.tmp / "missing.jsonl")}),
            json.dumps({}),
        ]
        for stdin in cases:
            with self.subTest(stdin=stdin):
                r = self.run_hook(stdin)
                self.assertEqual(r.returncode, 0)
                self.assertEqual(r.stdout, "")


class HomeCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.home = Path(self._tmp.name)
        (self.home / ".claude").mkdir()

    def settings(self, text):
        (self.home / ".claude" / "settings.json").write_text(text)

    def run_py(self, script, stdin="", **extra):
        env = os.environ.copy()
        env["HOME"] = str(self.home)
        env.pop("CONTEXT_AUTOCOMPACT_BUFFER", None)
        env.pop("CONTEXT_REMIND_TOKENS", None)
        env.update(extra)
        return subprocess.run([sys.executable, *script], input=stdin, text=True,
                              capture_output=True, env=env, timeout=30)


class CompactPointTest(HomeCase):
    def point(self, **env):
        code = f"import sys; sys.path.insert(0, {str(HOOKS)!r}); from compact import compact_point; print(compact_point())"
        r = self.run_py(["-c", code], **env)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout.strip()

    def test_value(self):
        self.settings('{"autoCompactWindow": 183000}')
        self.assertEqual(self.point(), "150000")

    def test_not_set(self):
        self.settings("{}")
        self.assertEqual(self.point(), "None")

    def test_missing_file(self):
        self.assertEqual(self.point(), "None")

    def test_bad_json(self):
        self.settings("{not json")
        self.assertEqual(self.point(), "None")

    def test_non_integer(self):
        self.settings('{"autoCompactWindow": "183000"}')
        self.assertEqual(self.point(), "None")

    def test_buffer_env(self):
        self.settings('{"autoCompactWindow": 183000}')
        self.assertEqual(self.point(CONTEXT_AUTOCOMPACT_BUFFER="40000"), "143000")


class StatuslineTest(HomeCase):
    GREEN, YELLOW, RED, RESET = "\033[32m", "\033[33m", "\033[31m", "\033[0m"

    def run_sl(self, payload, **env):
        return self.run_py([str(STATUSLINE)], payload if isinstance(payload, str) else json.dumps(payload), **env)

    def payload(self, n):
        return {"model": {"display_name": "Opus"}, "context_window": {"total_input_tokens": n}}

    def test_colors(self):
        self.settings('{"autoCompactWindow": 183000}')
        for n, color in ((79999, self.GREEN), (80000, self.YELLOW), (119999, self.YELLOW), (120000, self.RED)):
            with self.subTest(n=n):
                r = self.run_sl(self.payload(n))
                self.assertEqual(r.returncode, 0)
                self.assertEqual(r.stdout, f"Opus │ {color}ctx {n // 1000}k{self.RESET} │ 提醒 120k │ 壓縮 150k\n")

    def test_without_compact_segment(self):
        r = self.run_sl(self.payload(50000))
        self.assertEqual(r.stdout, f"Opus │ {self.GREEN}ctx 50k{self.RESET} │ 提醒 120k\n")

    def test_remind_env(self):
        r = self.run_sl(self.payload(50000), CONTEXT_REMIND_TOKENS="60000")
        self.assertIn(f"{self.GREEN}ctx 50k", r.stdout)
        self.assertIn("提醒 60k", r.stdout)

    def test_only_current_usage(self):
        r = self.run_sl({"model": {"display_name": "Sonnet"}, "context_window": {"current_usage": {
            "input_tokens": 1000, "cache_creation_input_tokens": 2000, "cache_read_input_tokens": 90000}}})
        self.assertIn("ctx 93k", r.stdout)
        self.assertIn(self.YELLOW, r.stdout)

    def test_bad_input_is_quiet(self):
        for stdin in ("not json", "", "[]", "null"):
            with self.subTest(stdin=stdin):
                r = self.run_sl(stdin)
                self.assertEqual(r.returncode, 0)
                self.assertEqual(r.stdout, "")


class SessionStartTest(unittest.TestCase):
    """一律用假 HOME 與暫存的 CLAUDE_PLUGIN_DATA，不碰真實 ~/.claude。"""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name).resolve()
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.proj = self.tmp / "proj"
        self.proj.mkdir()
        self.data = self.tmp / "data"
        self.first_line = GUIDE.read_text().strip().splitlines()[0]

    def run_hook(self, script=SESSION_START, data="default", plugin_root=None):
        env = os.environ.copy()
        env["HOME"] = str(self.home)
        env["CLAUDE_PROJECT_DIR"] = str(self.proj)
        env.pop("CLAUDE_PLUGIN_ROOT", None)
        env.pop("CLAUDE_PLUGIN_DATA", None)
        if data == "default":
            env["CLAUDE_PLUGIN_DATA"] = str(self.data)
        elif data is not None:
            env["CLAUDE_PLUGIN_DATA"] = str(data)
        if plugin_root:
            env["CLAUDE_PLUGIN_ROOT"] = str(plugin_root)
        return subprocess.run(["sh", str(script)], capture_output=True, text=True,
                              env=env, cwd=self.proj, timeout=30, stdin=subprocess.DEVNULL)

    def shown(self):
        p = self.data / ".route-setup-shown"
        return p.read_text().strip() if p.exists() else None

    def test_with_memory(self):
        mem = self.proj / "claude-memory"
        mem.mkdir()
        (mem / "MEMORY.md").write_text("- INDEX_MARKER_XYZ\n")
        (mem / "handoff.md").write_text("HANDOFF_MARKER_XYZ\n")
        (self.data).mkdir()
        (self.data / ".route-setup-done").touch()
        r = self.run_hook()
        self.assertEqual(r.returncode, 0)
        self.assertIn(self.first_line, r.stdout)
        self.assertIn("INDEX_MARKER_XYZ", r.stdout)
        self.assertIn("HANDOFF_MARKER_XYZ", r.stdout)

    def test_without_memory_does_not_load_auto_memory(self):
        am = self.home / ".claude" / "projects" / "x" / "memory"
        am.mkdir(parents=True)
        (am / "MEMORY.md").write_text("AUTO_MEMORY_MARKER\n")
        (self.data).mkdir()
        (self.data / ".route-setup-done").touch()
        r = self.run_hook()
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stderr, "")
        self.assertIn(self.first_line, r.stdout)
        self.assertNotIn("# 記憶索引（", r.stdout)
        self.assertNotIn("AUTO_MEMORY_MARKER", r.stdout)

    def test_no_marker_outputs_json(self):
        r = self.run_hook()
        self.assertEqual(r.returncode, 0)
        d = json.loads(r.stdout)
        self.assertEqual(d["hookSpecificOutput"]["hookEventName"], "SessionStart")
        self.assertEqual(d["hookSpecificOutput"]["additionalContext"].strip(),
                         GUIDE.read_text().strip())
        self.assertIn("/route-setup", d["systemMessage"])
        self.assertNotIn("smart-agent-route:route-setup", d["systemMessage"])
        self.assertEqual(self.shown(), "1")

    def test_plugin_root_uses_namespaced_command(self):
        r = self.run_hook(plugin_root=HOOKS.parent)
        d = json.loads(r.stdout)
        self.assertIn("/smart-agent-route:route-setup", d["systemMessage"])

    def test_json_includes_memory(self):
        mem = self.proj / "claude-memory"
        mem.mkdir()
        (mem / "MEMORY.md").write_text("- INDEX_MARKER_XYZ\n")
        d = json.loads(self.run_hook().stdout)
        self.assertIn("INDEX_MARKER_XYZ", d["hookSpecificOutput"]["additionalContext"])

    def test_counter_stops_at_three(self):
        for n in (1, 2, 3):
            r = self.run_hook()
            json.loads(r.stdout)
            self.assertEqual(self.shown(), str(n))
        r = self.run_hook()
        with self.assertRaises(ValueError):
            json.loads(r.stdout)
        self.assertIn(self.first_line, r.stdout)
        self.assertEqual(self.shown(), "3")

    def test_marker_means_plain_text(self):
        self.data.mkdir()
        (self.data / ".route-setup-done").touch()
        r = self.run_hook()
        self.assertIn(self.first_line, r.stdout)
        self.assertFalse(r.stdout.lstrip().startswith("{"))
        self.assertIsNone(self.shown())

    def test_default_state_dir_without_plugin_data(self):
        r = self.run_hook(data=None)
        json.loads(r.stdout)
        self.assertEqual((self.home / ".claude" / "hooks" / ".route-setup-shown").read_text().strip(), "1")

    def test_json_escaping_of_special_guide(self):
        hooks = self.tmp / "hooks"
        hooks.mkdir()
        shutil.copy(SESSION_START, hooks / "session-start.sh")
        text = 'quote " backslash \\ path C:\\x\\n tab\there\r\x01ctl \x1f 中文 {"a": 1}\n\n最後一行\n'
        (hooks / "guide.md").write_text(text, encoding="utf-8")
        r = self.run_hook(script=hooks / "session-start.sh")
        d = json.loads(r.stdout)
        got = d["hookSpecificOutput"]["additionalContext"]
        self.assertEqual(got.rstrip("\n"), text.replace("\r", "\r").rstrip("\n"))

    def test_statusline_sync_in_plugin_mode(self):
        dst = self.home / ".claude" / "smart-agent-route" / "statusline"
        dst.mkdir(parents=True)
        (dst / "statusline.py").write_text("old\n")
        r = self.run_hook(plugin_root=HOOKS.parent)
        self.assertEqual(r.returncode, 0)
        self.assertEqual((dst / "statusline.py").read_text(), STATUSLINE.read_text())
        self.assertEqual((dst / "compact.py").read_text(), COMPACT.read_text())

    def test_statusline_sync_skips_symlink(self):
        dst = self.home / ".claude" / "smart-agent-route" / "statusline"
        dst.mkdir(parents=True)
        target = self.tmp / "mine.py"
        target.write_text("mine\n")
        (dst / "statusline.py").symlink_to(target)
        self.run_hook(plugin_root=HOOKS.parent)
        self.assertTrue((dst / "statusline.py").is_symlink())
        self.assertEqual(target.read_text(), "mine\n")

    def test_no_sync_without_target_dir_or_plugin_root(self):
        self.run_hook(plugin_root=HOOKS.parent)
        self.assertFalse((self.home / ".claude" / "smart-agent-route").exists())
        dst = self.home / ".claude" / "smart-agent-route" / "statusline"
        dst.mkdir(parents=True)
        self.run_hook()  # 非 plugin 模式
        self.assertEqual(list(dst.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
