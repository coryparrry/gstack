# gstack — AI Engineering Workflow

gstack is a collection of SKILL.md files that give AI agents structured roles for
software development. Each skill is a specialist: CEO reviewer, eng manager,
designer, QA lead, release engineer, debugger, and more.

## Available skills

Skills live in `.agents/skills/`. Invoke them by name (e.g., `/office-hours`).

| Skill | What it does |
|-------|-------------|
| `/office-hours` | Start here. Reframes your product idea before you write code. |
| `/plan-ceo-review` | CEO-level review: find the 10-star product in the request. |
| `/plan-eng-review` | Lock architecture, data flow, edge cases, and tests. |
| `/plan-design-review` | Rate each design dimension 0-10, explain what a 10 looks like. |
| `/design-consultation` | Build a complete design system from scratch. |
| `/review` | Pre-landing PR review. Finds bugs that pass CI but break in prod. |
| `/debug` | Systematic root-cause debugging. No fixes without investigation. |
| `/design-review` | Design audit + fix loop with atomic commits. |
| `/qa` | Open a real browser, find bugs, fix them, re-verify. |
| `/qa-only` | Same as /qa but report only — no code changes. |
| `/ship` | Run tests, review, push, open PR. One command. |
| `/document-release` | Update all docs to match what you just shipped. |
| `/retro` | Weekly retro with per-person breakdowns and shipping streaks. |
| `/browse` | Headless browser — real Chromium, real clicks, ~100ms/command. |
| `/setup-browser-cookies` | Import cookies from your real browser for authenticated testing. |
| `/careful` | Warn before destructive commands (rm -rf, DROP TABLE, force-push). |
| `/freeze` | Lock edits to one directory. Hard block, not just a warning. |
| `/guard` | Activate both careful + freeze at once. |
| `/unfreeze` | Remove directory edit restrictions. |
| `/gstack-upgrade` | Update gstack to the latest version. |

## Build commands

```bash
bun install              # install dependencies
bun test                 # run tests (free, <5s)
bun run build            # generate docs + compile binaries
bun run gen:skill-docs   # regenerate SKILL.md files from templates
bun run skill:check      # health dashboard for all skills
```

## Key conventions

- SKILL.md files are **generated** from `.tmpl` templates. Edit the template, not the output.
- Run `bun run gen:skill-docs --host codex` to regenerate Codex-specific output.
- The browse binary provides headless browser access. Use `$B <command>` in skills.
- Safety skills (careful, freeze, guard) use inline advisory prose — always confirm before destructive operations.

## Codex Port Workstream

- This repo is being used to port gstack so it works in the Codex app with the same user-facing functionality as the CLI version.
- Project definition: preserve gstack's full user-facing behavior and cross-skill workflow exactly as experienced by the end user, while adapting only the underlying backend, tooling, and host integration needed to make it work reliably in the Codex app.
- Preserve behavior and cross-skill workflows. Change backend/tooling integration only when needed for Codex app compatibility.
- Be conscious of context-window usage. When reading long documents, large generated skills, or doing review-heavy analysis across many files, prefer subagents so the main thread stays compact.

## Subagent Use

For non-trivial engineering work, use `$agent-team-orchestrator` at `C:\Users\coryp\.codex\skills\agent-team-orchestrator` to decide when and how to delegate.

Apply these rules:
- Keep the main agent on the critical path. The main agent owns user communication, synthesis, final decisions, and any immediate blocking step.
- Use subagents for bounded sidecar tasks only when delegation improves parallelism, context isolation, or independent verification.
- Always spawn subagents with `model: "gpt-5.4-mini"`.
- Do not fork or pass the full thread by default.
- Prefer `fork_context: false` and pass only the minimum context needed: a short task summary plus the exact files, diffs, paths, symbols, commands, or artifacts required for the task.
- Use full-thread context only when a shorter context would materially risk correctness.
- Keep subagents read-only unless edits are specifically needed.
- Do not delegate work that is too ambiguous, too broad, or too context-heavy for `gpt-5.4-mini`; keep that work on the main agent.
- Prefer several small, well-scoped subagents over one vague general-purpose subagent.
- Do not delegate trivial single-file work or urgent blocking work that the main agent can complete faster directly.

Use these roles:
- `Explore scout`: read-only repo digging, dependency tracing, and source-of-truth discovery.
- `Planner`: decomposition only.
- `Reviewer`: correctness, architecture drift, security smell, duplicated-logic drift, and missing-test review.
- `Validator`: focused lint, typecheck, test, build, repro, or browser verification.
- `Handoff summariser`: compress subagent outputs into a compact parent-ready handoff.

Subagent prompts should be short, explicit, and bounded. Each subagent task should specify scope, allowed actions, deliverable, and stop condition.
