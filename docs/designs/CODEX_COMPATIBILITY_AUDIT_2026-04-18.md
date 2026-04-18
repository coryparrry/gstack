# Codex App Compatibility Audit - 2026-04-18

## Goal

Preserve gstack's CLI user-facing behavior and cross-skill workflows in the Codex app.
Only replace backend/tooling integration where the current CLI assumptions do not fit the
Codex desktop app runtime.

This audit is intentionally pre-implementation. No feature rewrite decisions are locked in
beyond the bucket classification below.

## Scope

Priority surfaces requested for this pass:

1. Repo-level setup flow
2. Skill generation for Codex
3. Routing assumptions
4. Browser runtime
5. Learnings and memory

## Audit Basis

- Read repo `AGENTS.md`
- Read `docs/designs/CODEX_PORT_HANDOFF_2026-04-18.md`
- Read Knowledge-Hub index plus relevant Codex lessons/recommendations
- Ran repo preflight and created branch `codex/compat-audit-2026-04-18`
- Used bounded `gpt-5.4-mini` explorer subagents for:
  - setup/install and Codex generation inventory
  - browser/runtime inventory
  - learnings/memory inventory
- Did not run live Codex app integration, live browser flows, or full test suites in this pass

## Classification Rules

- `Direct lift`: preserve as-is or nearly as-is
- `Lift with shim`: preserve behavior, but wrap filesystem/CLI assumptions with an app adapter
- `Backend rewrite for Codex app`: current implementation model does not fit the app host
- `Parity-risk / needs deeper validation`: likely important, but current evidence is not enough to call it safe

## Executive Summary

The repo already has a useful split between generated skill content and host-specific config,
which is the strongest starting point for parity. The weak point is not skill text generation;
it is the runtime model around installation, browser orchestration, routing injection, and
memory persistence. Those areas are currently built around shell scripts, local filesystem
layouts, symlink installs, `CLAUDE.md` mutation, temp files, and localhost daemons.

The safest port shape is:

- lift the host-config and template-generation system
- keep the behavioral contracts and tests as parity targets
- replace the install/runtime substrate with Codex-app-native plumbing
- explicitly revalidate cross-skill persistence and browser parity before porting dependent skills

## Area Summary

| Area | Primary Bucket | Why |
| --- | --- | --- |
| Codex host config and generated skill shape | Direct lift | Already declarative and test-backed |
| Setup/install flow | Lift with shim | Behavior is portable, implementation is shell/symlink-heavy |
| Runtime root and sidecar layout | Backend rewrite for Codex app | Assumes `~/.codex/skills`, `.agents/skills`, and symlinked repo assets |
| Routing and preamble behavior | Lift with shim | Behavioral contract matters, but current mechanism is `CLAUDE.md` and shell checks |
| Browser command protocol | Direct lift | Command/ref protocol is portable |
| Browser daemon, real-browser mode, extension path | Backend rewrite for Codex app | Built around local CLI + Playwright + localhost daemon + Chrome side panel |
| Learnings data model | Direct lift | Append-only JSONL + latest-wins semantics are sound |
| Learnings runtime integration | Lift with shim | Current commands assume shell binaries and host paths |
| Cross-skill external Codex invocation from gstack skills | Parity-risk / needs deeper validation | Current Codex host intentionally suppresses several self-invoking flows |

## Detailed Audit

### 1. Setup Flow

#### Direct lift

- Host selection and host registry structure are already centralized in `hosts/*.ts`,
  `hosts/index.ts`, and `scripts/host-config.ts`.
- The high-level distinction between host config, generation, runtime-root assets, and
  install behavior should remain the core architecture.

#### Lift with shim

- The `setup` script's host branching, migration logic, and asset linking are conceptually
  reusable, but only behind a Codex-app installer layer.
- `create_codex_runtime_root` and `create_agents_sidecar` describe the desired resulting
  artifact shape, but not an app-native implementation.
- The current install flow assumes shell execution, repo-local clones, symlink creation,
  and direct writes into user home directories.

#### Backend rewrite for Codex app

- Any logic that depends on:
  - `~/.codex/skills/gstack`
  - `.agents/skills/gstack`
  - symlinked runtime assets from the repo checkout
  - direct-install migration into `~/.gstack/repos/gstack`
  should be considered app-substrate code, not portable behavior.

#### Parity-risk / needs deeper validation

- Codex currently blocks `--local` and migrates direct installs away from `~/.codex/skills/gstack`.
  That may be correct for CLI Codex, but it needs explicit product validation for desktop Codex.
- The current tests validate generated output shape more than end-to-end install behavior.

### 2. Skill Generation for Codex

#### Direct lift

- Codex generation is the cleanest part of the port.
- `hosts/codex.ts` already encodes:
  - frontmatter allowlist
  - description cap
  - `openai.yaml` generation
  - path rewrites
  - suppressed resolvers
  - `/codex` omission from generated Codex skills
- `scripts/gen-skill-docs.ts` is already host-driven rather than Codex-special-cased everywhere.
- Existing tests provide a strong parity target for:
  - generated file locations
  - `gstack-*` naming
  - `.claude` path removal
  - `agents/openai.yaml` emission

#### Lift with shim

- If the Codex app consumes the same `openai.yaml` sidecar contract, generation can stay unchanged.
- If the app's skill-discovery root differs, keep generation behavior but redirect output paths.

#### Backend rewrite for Codex app

- If the app does not consume `agents/openai.yaml`, metadata emission becomes a backend adapter concern.
- If the app's tool names or mounted paths differ from CLI Codex, the current literal path/tool
  rewrites need an app-aware replacement.

#### Parity-risk / needs deeper validation

- Codex generation intentionally suppresses `DESIGN_OUTSIDE_VOICES`, `ADVERSARIAL_STEP`,
  `CODEX_SECOND_OPINION`, `CODEX_PLAN_REVIEW`, `REVIEW_ARMY`, and GBRAIN load/save.
- That is a deliberate anti-self-invocation safety choice, but it may reduce behavioral parity
  for cross-skill workflows unless the Codex app offers an equivalent backend capability.

### 3. Routing Assumptions

#### Direct lift

- The routing intent itself is worth preserving:
  - use strong skill routing
  - load prior learnings at session start
  - maintain project-scoped memory
  - bias toward structured workflows rather than ad hoc replies

#### Lift with shim

- `scripts/resolvers/preamble.ts` contains the desired routing behavior, but the mechanism is
  tied to `CLAUDE.md` checks, shell commands, and local repo mutation guidance.
- `skill-routing-e2e` is useful as a behavioral spec even though the current mechanism is
  Claude-specific.

#### Backend rewrite for Codex app

- Any dependency on:
  - `CLAUDE.md` append/update flows
  - commit instructions for routing changes
  - branch-local prompt/routing scaffolding
  should be replaced with Codex-app-native routing configuration.

#### Parity-risk / needs deeper validation

- A port that only copies generated skill files without recreating the routing substrate will feel
  behaviorally incomplete even if the skills exist on disk.
- The repo currently uses prompt-level and file-level routing reinforcement together; the app may
  need equivalent host-level reinforcement to preserve invocation quality.

### 4. Browser Runtime

#### Direct lift

- The browser command protocol itself is portable:
  - command registry
  - read/write/meta split
  - ref-based interaction model
  - snapshot and batch concepts
- `find-browse.ts` is also a simple reusable discovery helper if a local helper binary still exists.
- Cookie decryption and parsing logic are reusable as pure capability code.

#### Lift with shim

- Browser state save/restore and cookie-import workflows can survive with an app shim if the app
  still supports persistent Playwright/Chromium contexts or an equivalent browser session model.
- `open-gstack-browser` and `setup-browser-cookies` are workflow-level contracts that could remain
  user-facing if the backing entrypoints are adapted.

#### Backend rewrite for Codex app

- The current browser runtime is fundamentally CLI/daemon oriented:
  - compiled local browse binary
  - localhost HTTP server
  - `.gstack/browse.json` state file
  - bearer token auth for the local server
  - process watchdogs and `taskkill`
  - optional ngrok/sidebar surfaces
  - headed Chrome/Chromium control on port `34567`
  - browser extension side panel
- Real-browser mode is the single biggest host-integration rewrite in this workstream.

#### Parity-risk / needs deeper validation

- There is no single obvious browser session-store abstraction in this checkout; persistence appears
  split across `browse/src/server.ts` and `browse/src/browser-manager.ts`.
- The current test coverage does not prove full headed-browser parity for a Codex desktop app.
- The key product question is whether Codex desktop should:
  - host the existing local-helper model,
  - wrap it,
  - or replace it with app-native browser tooling while preserving the same user-facing behavior.

### 5. Learnings and Memory

#### Direct lift

- The learnings data model is strong and portable:
  - append-only JSONL
  - project-scoped slugging
  - latest-wins dedup by `key + type`
  - explicit search/export/prune/stats/manual-add operations
- Cross-skill use of learnings is already meaningful, not cosmetic:
  - preamble loads recent learnings
  - review-army consults prior pitfalls
  - review logs plan-gap learnings

#### Lift with shim

- `scripts/resolvers/learnings.ts` already has a simplified Codex branch that avoids the Claude
  cross-project prompt and uses `$GSTACK_BIN`.
- That suggests the intended Codex behavior is known, but it still assumes shell execution and
  a local binary path.
- The injection-safety discipline in the learnings tests should be preserved exactly.

#### Backend rewrite for Codex app

- `learningsMode` exists in host config but does not appear to be strongly consumed by runtime code.
  The current Codex `basic` mode is therefore a declared intent more than an enforced runtime boundary.
- Review and plan-gap memory writes currently depend on temp files, shell commands, and local
  filesystem logging. Durable Codex-app memory likely needs an API-native persistence path.

#### Parity-risk / needs deeper validation

- The `learn` skill template still hardcodes Claude-era binary paths in the template/body.
- Cross-skill persistence depends on more than the learnings store:
  - branch-local session state
  - preamble injection
  - routing configuration
- Porting only `learnings.jsonl` semantics without the surrounding session/routing substrate will
  underdeliver on behavioral parity.

## Cross-Cutting Findings

### Strongest direct-lift assets

- Host config registry and generator architecture
- Codex-specific generation rules
- Skill behavior encoded in templates and resolver contracts
- Test suite as parity-spec input
- Learnings data model
- Browser command/ref protocol

### Strongest rewrite boundaries

- Installer/runtime-root substrate
- Browser daemon and real-browser mode
- Routing substrate currently implemented through `CLAUDE.md` and shell guidance
- Durable memory/logging paths currently implemented through local binaries and filesystem writes

### Most important parity risks

1. Codex app may not want or allow the current filesystem install layout.
2. Real-browser support is deeply tied to CLI-local daemon assumptions.
3. Codex host currently suppresses multiple self-invoking or multi-voice workflows by design.
4. Routing and memory parity depend on host behavior, not just generated skill files.
5. Existing tests prove generator/runtime slices, but not full Codex desktop parity.

## Recommended Next Steps

1. Freeze this audit as the source-of-truth classification for the port.
2. Define the Codex-app-native substrate for:
   - skill install/discovery
   - runtime-root asset access
   - routing configuration
   - durable memory/logging
   - browser helper orchestration
3. Preserve generator behavior and current host-config shape unless a concrete Codex app constraint
   forces a change.
4. Build parity checks per surface:
   - generation output parity
   - routing invocation parity
   - learnings read/write parity
   - browser command parity
   - real-browser/manual-cookie parity
5. Decide whether suppressed Codex self-invocation flows are:
   - intentionally non-parity for safety,
   - or need a Codex-app-native replacement path.

## Validation Status

Validated in this audit:

- Instruction chain and Knowledge-Hub context
- Git preflight and branch isolation
- Static code inspection for setup, generation, routing, browser runtime, and learnings/memory
- Existing relevant tests and docs as parity evidence
- Three bounded subagent evidence passes on the long review surfaces

Not validated in this audit:

- Live Codex desktop integration
- Live `setup` execution
- Live skill generation run
- Live browser daemon, headed browser, extension, or cookie-import flows
- Full automated test suites
- End-to-end Codex app behavior under real session persistence
