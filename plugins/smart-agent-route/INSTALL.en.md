# Installing in three environments

[English](INSTALL.en.md) | [繁體中文](INSTALL.md)

The short version:

| Environment | How to install | Shared with |
|---|---|---|
| **Cowork (desktop)** | Click the `.plugin` file to install | Its own setup |
| **Claude Code CLI** | Run `install.sh` | ← shared with VS Code |
| **VS Code extension** | Same as above; install once, both get it | ← shared with CLI |

**The CLI and VS Code share `~/.claude/`, so one install covers both.** Cowork uses its own install flow and needs a separate install.

---

## Cowork (desktop)

Click the install button on the `.plugin` file. **It works right after install** (for the full feature set, such as the status line, auto-compact threshold, Haiku Explore, and claude-memory, run `/smart-agent-route:route-setup`), and **it is available in every conversation** (a plugin is user-level, not tied to a conversation).

To verify, ask in a new conversation "which agents are available?". You should see `worker`, `worker-hard`, `bulk`, `librarian`, and `harvester`.

---

## Claude Code CLI and VS Code extension

These two share the same configuration, so do the steps below once.

### One-command install

Run from the repo root (or put `install.sh` and `smart-agent-route.plugin` in the same directory; without a `.plugin`, the script uses `plugins/smart-agent-route/` directly):

```bash
bash install.sh
```

The script **copies** agents, skills, and hooks into `~/.claude/` (`agents/*.md` → `~/.claude/agents/`, `skills/<name>/` → `~/.claude/skills/`, `hooks/` → `~/.claude/hooks/smart-agent-route/`). No marketplace and no `/plugin install` needed. Note that Claude Code does not load a plugin folder placed under `~/.claude/skills/`, so the script spreads the contents out instead of dropping the whole package in; leftovers from older script versions in `~/.claude/skills/smart-agent-route/` are removed automatically.

In this mode names have **no namespace**: the agent is `worker` (not `smart-agent-route:worker`) and the skill is `/handoff`.

Installed items are recorded in `~/.claude/.smart-agent-route-installed`. For an existing file with the same name: identical content is added to the manifest; different content (your own) is left alone with a warning; symlinks (from `--link`) are not touched.

**Hooks are not enabled automatically.** The script does not edit your `settings.json`. It prints a settings snippet at the end, which you merge into `"hooks"` in `~/.claude/settings.json` yourself (remove any older hook of the same kind first).

Restart Claude Code after installing and you can start using it. For the full feature set (status line, auto-compact threshold, Haiku Explore, claude-memory), run `/route-setup` (in this mode, paste the hooks into settings.json first, otherwise the reminder will not appear).

### Status line (optional)

Add `--with-statusline` (it can be combined with the default copy mode or `--link`, but not with `--agents-only` or `--uninstall`). The script only handles the `statusLine` key in `~/.claude/settings.json`: it creates the file if missing; if `statusLine` already exists it does not overwrite it and only prints a suggested snippet; otherwise it first backs the file up as `settings.json.bak-<timestamp>`, then adds just this one key. If the JSON is broken or python3 is missing, it changes nothing. To do it by hand, paste this (the path applies only to install.sh installs; plugin users should use `/smart-agent-route:route-setup`):

```json
"statusLine": { "type": "command", "command": "python3 ~/.claude/hooks/smart-agent-route/statusline.py" }
```

We also recommend `"autoCompactWindow": 183000` (the script does not write it): after subtracting a buffer of about 33k, auto-compact triggers at roughly 150k, leaving about 30k of headroom after the 120k reminder to write the handoff. The 33k figure was measured on the author's machine; confirm it with `/context` after installing.

### Verify

```
/agents
```

You should see five agents (`worker`, `worker-hard`, `bulk`, `librarian`, `harvester`). Or try an @-mention:

```
@agent-worker
```

Once the hooks snippet is pasted, check it with `/hooks`.

If you also want code search to run on Haiku, add `--with-explore` (it places `skills/route-setup/templates/Explore.md` into `~/.claude/agents/`, and does not overwrite an existing file):

```bash
bash install.sh --with-explore
```

### If the agents do not appear

First make sure you restarted Claude Code, then check that the five `.md` files exist under `~/.claude/agents/`. If you want only the agents and not the skills and hooks, use:

```bash
bash install.sh --agents-only
```

This copies only the agent definitions (also recorded in the manifest). The trade-off: hooks (context reminder, memory injection at session start) and skills (`/handoff`, `/research`, `/usage-stats`) will not take effect.

### Maintaining it yourself, with edits taking effect immediately

```bash
bash install.sh --link
```

This symlinks agents, skills, and hooks to the files in the repo, so `git pull` or your own edits apply without reinstalling. Names have no namespace (`worker`, `/handoff`). The script does not edit `settings.json`; it prints a hooks snippet for you to paste. Existing files with the same name are never overwritten; if you move the repo, just run it again.

### Just trying it, without installing

```bash
claude --plugin-dir ./smart-agent-route.plugin
```

`--plugin-dir` accepts a zip archive, and a `.plugin` is a zip. This only lasts for the current session, which suits a quick trial.

---

## Version requirements

This plugin uses a few newer frontmatter fields:

| Field | Purpose | If unsupported |
|---|---|---|
| `model` | Sets which model an agent uses | Everything follows the main conversation model; tiering stops working |
| `memory` | Persistent memory | Memory stops working (the connected-folder route still works) |
| `effort` | Sets reasoning effort by cost of failure | Follows the session setting |
| `omitClaudeMd` | bulk does not load CLAUDE.md (needs 2.1.271+) | CLAUDE.md is loaded too; costs more but works |

The context-length reminder hook needs `python3`; if it is not found, the hook quietly disables itself.

Check your version:

```bash
claude --version
```

If it is too old:

```bash
claude update
```

Also, `memory` depends on auto memory. If you disabled `autoMemoryEnabled` or set the environment variable `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, that field has no effect. In that case use the "`claude-memory/` in a connected folder" route (worker prefers it anyway).

---

## Set the main conversation model separately

**The plugin only defines subagents; it does not change your main conversation model.** You need to turn on the first tier yourself:

```
/model opus
```

Or put it in `~/.claude/settings.json`:

```json
{ "model": "opus" }
```

If you do not set it, the main conversation uses your existing default model, and the quality of delegation decisions drops.

---

## Memory folder in each environment

Memory lives in a **folder you choose**, not inside the plugin. Each of the three environments connects it differently:

- **Cowork**: connect the memory folder every time you start a new conversation. This is the only step you have to repeat; forget it and you effectively lose your memory.
- **CLI**: start the session inside the memory folder, or treat it as the project root.
- **VS Code**: add the memory folder to your workspace.

If all three point to the **same folder**, memory is shared. This is also why we suggest opening that folder in Obsidian: it is where agents read and write, where you view and tidy, and what each environment connects to.

---

## Updating

Just re-run `install.sh`: items in the manifest (installed earlier) are deleted and recopied as the new version, and your own same-named files are left alone. On Cowork, click the new `.plugin` file again.

**Remember to update both sides.** Behavior differs between versions, and this kind of problem is hard to notice: you will think an agent is unreliable when the two machines are actually running different versions.
