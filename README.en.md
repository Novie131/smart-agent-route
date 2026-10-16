# Smart Agent Route

[English](README.en.md) | [繁體中文](README.md)

A Claude Code plugin for tiered model delegation: **the main conversation thinks with Opus, Sonnet executes, and Haiku handles retrieval and bulk reading.** It reminds you when the context window gets long and writes handoff notes, so you can clear the conversation without worry. Knowledge accumulates across conversations, and external information is cited with its source.

The Traditional Chinese docs are the primary version; this English version is a translation and may lag behind.

---

## Install

```
/plugin install smart-agent-route --marketplace Novie131/smart-agent-route
/reload-plugins
```

(Claude Code 2.1.275 and earlier: first run `/plugin marketplace add Novie131/smart-agent-route`, then `/plugin install smart-agent-route@smart-agent-route`.)

It works right after install, with no further setup. For the full feature set (context status line, auto-compact threshold, Haiku-based Explore, a claude-memory store), run this inside Claude Code:

```
/smart-agent-route:route-setup
```

It explains each item one at a time (what it does, its impact, how to undo it), asks one question per item, and you can skip any of them. It backs up `settings.json` before writing and never overwrites values that already exist. If you have not run route-setup, the session start hook reminds you (at most 3 times). Setting the main conversation model to Opus (`/model opus`) is recommended; this is never changed automatically.

Without a `claude-memory/` folder, memory falls back to Claude Code's own auto memory, which works fine. `claude-memory/` is an advanced option (it can go into git and be shared across environments).

The context-length reminder needs `python3`; without it, the reminder hook quietly disables itself.

If you prefer not to use the marketplace, the repo ships `install.sh`, or you can run `claude --plugin-dir ./plugins/smart-agent-route` directly.

### Install with install.sh

```
bash install.sh                    # copy install (agents, skills, hooks go into ~/.claude/, no namespace prefix; re-run to update)
bash install.sh --agents-only      # copy agents only (hooks and skills will not take effect)
bash install.sh --link             # symlink agents, skills, hooks (edits in the repo apply immediately)
bash install.sh --uninstall        # remove (follows the install manifest, leaves your own files alone)
bash install.sh --with-explore     # also install the Haiku-based Explore into ~/.claude/agents/
bash install.sh --with-statusline  # also add the context status line to ~/.claude/settings.json
```

Notes:

- Names have no namespace in this mode: the agent is `worker` and the skill is `/handoff` (plugin install uses `smart-agent-route:worker`).
- Installed items are recorded in `~/.claude/.smart-agent-route-installed`. Existing files with identical content are added to the manifest; files with different content (yours) are not overwritten, and you get a warning.
- `--with-statusline` can be combined with the default copy mode or `--link`, but not with `--agents-only` or `--uninstall`. It touches only the `statusLine` key in `settings.json`: it creates the file if missing, never overwrites an existing `statusLine` (it only prints a suggested snippet), and otherwise backs the file up as `settings.json.bak-<timestamp>` before writing. It does nothing if the JSON is broken or python3 is missing.
- install.sh does not edit your `settings.json` hooks. It prints a snippet at the end that you merge into `"hooks"` yourself. After that, run `/route-setup` for the full feature set.

For more detail, see the [deployment notes](docs/%E9%83%A8%E7%BD%B2%E5%AE%89%E8%A3%9D.md) (Traditional Chinese only) and [plugins/smart-agent-route/INSTALL.en.md](plugins/smart-agent-route/INSTALL.en.md).

---

## Architecture

```
You ──► main conversation (Opus)  ← the front door: understands, decides who gets the work
          │
          ├──► worker (Sonnet)       ← direction is settled, just do it
          │      └► worker-hard       ← escalation after worker fails
          ├──► bulk (Haiku)          ← lots to read, only conclusions needed: images, long logs, web pages
          ├──► librarian (Haiku)     ← searches the knowledge base. Read-only
          └──► harvester (Sonnet)    ← mines past conversations into the knowledge base. Manual trigger

skill: handoff (handoff notes), research (look up external info with sources), usage-stats (measure context and subagent usage), route-setup (one-time full setup)
hook : session start injects the delegation guide and memory; a reminder fires when the context gets long
```

What each component is for:

- **worker** (Sonnet, `effort: medium`): does work whose direction is already decided, such as writing code, fixing bugs, adding tests. It must verify before reporting done.
- **worker-hard** (Sonnet, `effort: high`): only used after worker fails, and the delegation must include the previous failure report.
- **bulk** (Haiku): reads large amounts of material and returns only conclusions: many images, long logs, web pages, commands with huge output, and mechanical batch edits.
- **librarian** (Haiku, `effort: low`): searches the knowledge base and memory. It has only `Read`, `Glob`, and `Grep`, so it cannot modify anything, and it returns verbatim excerpts with their sources, plus which terms it searched and what it did not find.
- **harvester** (Sonnet): mines past conversation transcripts into knowledge-base notes. Only runs when you explicitly ask; it is a costly batch job.
- **Explore** (Haiku, optional): the built-in Explore runs on Opus when the main conversation is Opus. A plugin cannot override it (only a user- or project-level agent named `Explore` can), so route-setup or `bash install.sh --with-explore` installs a Haiku version into `~/.claude/agents/`.
- **Skills**: `handoff` writes `handoff.md`; `research` looks up external information and cites sources; `usage-stats` measures main-conversation context length and the share of work done by subagents (read-only); `route-setup` is the one-time full setup.
- **Hooks**: SessionStart injects the delegation guide, the memory index, and the handoff note; UserPromptSubmit reminds you when the context window is too long.

**Routing happens after Opus, not before.** Judging intent requires reading the message, and reading it is already planning, so a cheap router in front is not possible. Opus is always the entry point and does the delegating.

The cost still works out: planning is one message, while an execution loop is often dozens of tool calls. The biggest saving, though, is **context isolation**. Every message in a conversation is resent on every later turn; keeping tool calls inside a subagent's separate context window means the main conversation receives only a summary.

**But isolation only covers tool calls, not the conversation itself growing longer.** Measured on one heavy user across 21 sessions, the median context per main-conversation call was about 240k tokens, mostly re-reading old conversation. So the plugin also watches length: it reminds you past 120k tokens, you write the current state with the handoff skill and run `/clear`, and the new session picks up automatically.

Design rationale and trade-offs are in [docs/spec.md](docs/spec.md) (Traditional Chinese).

### Delegation and failure escalation

Just talk normally; the main conversation decides whether to delegate. For example: deciding how to approach something stays on Opus; "do what we just discussed" goes to worker; "did I note anything about X before?" goes to librarian; "check these 18 screenshots for layout breakage" or "why did this log fail" goes to bulk; "how do I configure the new version of this API" uses the research skill; "hand off" or a context-length reminder triggers the handoff skill, after which you can `/clear`. To force a specific subagent, use `@agent-smart-agent-route:worker`.

Failure escalation order: re-delegate to the same agent with added background, then bulk failure falls back to worker, worker failure goes to worker-hard (with the previous failure report), and if that still fails it stops to re-plan or ask you. It never escalates endlessly.

### Subagent report format

Subagents finish with a fixed report format so the main conversation can decide the next step from the first two lines: a status line (done, failed, or needs a decision) and a verification line (passed, not verified, or failed). Done is only allowed together with verification passed. If a subagent hits a fork that requires a decision, it stops and reports the options and their consequences instead of picking one itself.

---

## Memory

```
<your folder>/claude-memory/
├── MEMORY.md    ← resident index, injected by the hook at session start, 40-line budget
├── handoff.md   ← handoff note, injected automatically into the next session
├── topics/      ← knowledge accumulated by agents
├── kb/          ← your own notes
└── web/         ← external-info notes saved by research (with source and expiry date)
```

`MEMORY.md` **holds only trigger conditions; the knowledge itself lives in topic files.** This makes cost proportional to how much you use this time, not to how much is remembered in total: knowledge can grow without limit while the fixed startup cost stays constant.

Write the index as conditions, not topics:

- ✗ `setup.md — about environment setup` (a topic)
- ✓ `setup.md — read first when you need to change paths or a command will not run` (a condition)

Where memory lives:

- Agents prefer the `claude-memory/` folder inside a connected (working) folder, and fall back to their own agent memory directory (`~/.claude/agent-memory/worker/`) when it is missing.
- In Claude Code (terminal) the fallback persists across conversations. In Cowork (desktop) the sandbox home directory is rebuilt every session, so only the connected folder survives: connect it again in each new conversation.
- Without `claude-memory/`, memory falls back to Claude Code's auto memory. If you disabled `autoMemoryEnabled` or set `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, the `memory` field has no effect, and connecting a folder becomes required rather than optional.
- The folder opens directly as an Obsidian vault with no integration needed, since a vault is just a pile of `.md` files. Use a new, dedicated vault rather than your existing personal notes, because agents have write access.
- Memory should record "how to do it next time", not "what was done this time". A running log does not make the next run faster.

Keeping `MEMORY.md` thin matters: it is truncated beyond its limit (the hook injects up to 120 lines; auto memory 200), and resident content is a fixed cost paid in every session. It decays over time, so tidy it periodically; more than 150 lines is the warning sign.

---

## This is RAG, just without vectors

`librarian` retrieves using keyword search and conditional judgment. At personal scale (dozens to hundreds of notes) this is usually better than vectors: no extra infrastructure, retrieval failures are explainable, and chunking does not break Markdown structure. It also swaps synonyms, switches languages, and retries by searching file names, which a fixed vector query cannot do.

Vectors are worth considering only for thousands of notes, large numbers of PDFs, or long transcripts. At that point the markdown in `kb/` can serve directly as the corpus.

---

## Saving tokens and the context window

Four levers, in order of impact:

1. **Context isolation** (the biggest, and it compounds). Every message and tool result is resent on each later turn. Running 30 tool calls in the main conversation means paying for those 30 results until the conversation ends; in a subagent, the main conversation receives only a summary. Delegate whole chunks of work, not single steps, because each subagent launch pays the system prompt and memory injection again.
2. **Model tiering.** Useful but linear: the saving is roughly the price difference.
3. **`effort` levels.** worker uses `medium`, escalating to worker-hard (`high`) only on failure; librarian uses `low`.
4. **Do not keep the main conversation open too long.** An Opus conversation that keeps growing is the quietest leak. The UserPromptSubmit hook reminds you once when the context passes 120k tokens, then every additional 40k (adjust the threshold with the environment variable `CONTEXT_REMIND_TOKENS`). On reminder, Claude writes the current state into `handoff.md` with the handoff skill (current task / done / next steps / open questions), then gives you a copyable command: `/clear` if you are at a stopping point, `/compact` with a focus if you are mid-task, or `/rewind` with a partial summary if the later part is debugging noise. The SessionStart hook injects `claude-memory/handoff.md` into the next session.

Recommended: set auto-compact as a safety net in `~/.claude/settings.json` (a plugin cannot set it for you; `/smart-agent-route:route-setup` writes it safely):

```
"autoCompactWindow": 183000
```

After subtracting a buffer of about 33k, auto-compact triggers at roughly 150k, leaving about 30k of headroom after the 120k reminder to write the handoff. The 33k figure was measured on the author's machine; confirm the Autocompact buffer with `/context` (and also check any per-model overrides in `modelSettings`).

**Status line** (optional): shows `model │ ctx 95k │ reminder 120k │ compact 150k`, with the compact point read from `autoCompactWindow` (not shown if unset). A plugin cannot configure the main status line, so use `bash install.sh --with-statusline`, or paste this into settings.json by hand (this path applies only to install.sh installs; plugin users should use `/smart-agent-route:route-setup`, which places the file in a fixed location):

```json
"statusLine": { "type": "command", "command": "python3 ~/.claude/hooks/smart-agent-route/statusline.py" }
```

The reminder text also includes the estimated compact point.

---

## Extending: when to add a Haiku layer

`skills/route-setup/templates/runner.md.example` is a reserved slot that is **deliberately not loaded**. The Haiku layer is the only layer that really saves money and the only one that is really risky: it does not stop to ask, it quietly does what it thinks you meant. So each Haiku agent must be bound to one concrete task. Enable one only when all three hold: you have done the task three to five times with nearly the same steps; success is obvious at a glance; and mistakes are affordable and reversible (nothing deleted, sent out, or overwritten without a backup). Otherwise leave it with worker. Retrieval (librarian) is the exception, because it is read-only.

---

## Knowledge base and harvester

You can feed the knowledge base in two ways: drop `.md` files into `kb/` yourself (no preprocessing, librarian finds them immediately), or ask `harvester` to mine past conversations (it lists the available sessions and lets you choose the scope first). Four limits to know:

- It only sees local sessions; conversations on the web or mobile are out of scope.
- It is costly, so treat it as an occasional batch job, not an always-on feature.
- Extraction is always lossy: spot-check the output, especially the first few runs.
- It writes into `kb/`, which is otherwise yours. If you care about that boundary, have it write to `kb/harvested/` first.

Run it once after first install to seed the knowledge base; after that worker records memory as it goes, so it is rarely needed again.

---

## Layout

```
smart-agent-route/
├── .claude-plugin/marketplace.json   ← marketplace catalog
├── plugins/smart-agent-route/            ← the plugin itself
│   ├── .claude-plugin/plugin.json
│   ├── agents/                       ← worker / worker-hard / bulk / librarian / harvester
│   ├── skills/                       ← handoff / research / usage-stats / route-setup
│   ├── hooks/                        ← SessionStart injection, context-length reminder
│   (templates are in skills/route-setup/templates/: MEMORY.md, knowledge-base guide, Explore, Haiku-layer example)
├── docs/
│   ├── spec.md                       ← architecture design and implementation appendix (Traditional Chinese)
│   └── ...                           ← deployment and publishing notes (Traditional Chinese only)
├── claude-memory/                    ← memory store (not under version control)
└── install.sh                        ← install method that skips the marketplace
```

---

## Status

**v0.8.0, early version.** Versions up to 0.7.0 were named tiered-agents; to upgrade, remove the old version first (see the section on upgrading from tiered-agents (0.7.0 and earlier) in the [deployment notes](docs/%E9%83%A8%E7%BD%B2%E5%AE%89%E8%A3%9D.md)). The context reminder hook, handoff, bulk, and the Explore override were ported from the author's personal setup: the hook has fired in real conversations and Explore and bulk are confirmed to run on Haiku, but all are still being validated. The worker-hard escalation chain, the research skill, and the plugin form of the hooks have not been used in practice yet.

Known rough edges:

- Delegation relies on `description` matching and is not guaranteed. To be sure, use `@agent-smart-agent-route:worker`.
- Hook behavior in Cowork is unverified.
- `MEMORY.md` decays and needs periodic tidying (over 150 lines is the signal).
- The Haiku execution layer is empty by default; see the enabling conditions in `plugins/smart-agent-route/skills/route-setup/templates/runner.md.example`.
- `harvester` only reads local sessions.

Issues are welcome.

---

## License

MIT
