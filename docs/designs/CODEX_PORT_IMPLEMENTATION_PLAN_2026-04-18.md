# Codex Port Implementation Plan - 2026-04-18

## Goal

Turn the compatibility audit into a phased implementation sequence for porting `gstack`
to the Codex app with full behavioral parity, while preserving current CLI behavior and
cross-skill workflows.

This plan is intentionally execution-oriented:

- phase order
- concrete file targets
- validation gates
- explicit out-of-scope boundaries per phase

## Source Inputs

- [CODEX_COMPATIBILITY_AUDIT_2026-04-18.md](./CODEX_COMPATIBILITY_AUDIT_2026-04-18.md)
- [CODEX_PORT_HANDOFF_2026-04-18.md](./CODEX_PORT_HANDOFF_2026-04-18.md)

## Delivery Strategy

Implement the port in substrate-first order.

Do not start by rewriting individual skills.

The correct sequence is:

1. Codex app substrate
2. Generation/discovery parity harness
3. Routing and session substrate
4. Learnings and durable memory substrate
5. Browser command/runtime substrate
6. Cross-skill parity restoration
7. Full regression and docs close-out

## Non-Goals

These are explicitly out of scope unless a later phase proves they are required:

- redesigning the skill taxonomy
- simplifying the product into a reduced Codex-only subset
- changing user-facing command names to fit implementation convenience
- replacing the generator architecture unless the Codex app forces it
- rewriting skills before the underlying host/runtime substrate exists

## Phase 0: Freeze The Parity Contract

### Objective

Lock the audit findings into a practical engineering target before any backend work starts.

### Deliverables

- This plan document
- A parity checklist derived from the audit
- A short “do not change behavior” baseline for Codex generation and routing

### File targets

- `docs/designs/CODEX_COMPATIBILITY_AUDIT_2026-04-18.md`
- `docs/designs/CODEX_PORT_IMPLEMENTATION_PLAN_2026-04-18.md`
- likely new: `docs/designs/CODEX_PARITY_CHECKLIST_2026-04-18.md`

### Validation

- Human review only
- Ensure every major audit bucket is represented in later phases

### Exit criteria

- No implementation batch starts without mapping back to one or more audit findings

## Phase 1: Define The Codex App Host Substrate

### Objective

Replace the current CLI install/runtime-root assumptions with a Codex-app-native substrate
without changing skill behavior yet.

### Why first

Everything else depends on how the Codex app will:

- discover generated skills
- load metadata
- access runtime assets
- persist app-owned state

### Primary questions to answer

1. Where do generated Codex artifacts live for the app?
2. Does the app consume `agents/openai.yaml` directly or need a different metadata adapter?
3. How are runtime-root assets exposed without repo-to-home symlink assumptions?
4. What replaces `setup` for Codex desktop?
5. What app-owned storage is available for session state, logs, and learnings?

### File targets

- `hosts/codex.ts`
- `hosts/index.ts`
- `scripts/host-config.ts`
- `scripts/gen-skill-docs.ts`
- `setup`
- likely new:
  - `codex/` runtime adapter files
  - `scripts/` helper(s) for app-oriented export/package layout
  - possibly `extension/` or `codex/` packaging manifest files depending on plugin shape

### Implementation notes

- Preserve host config semantics where possible.
- Do not delete the current CLI Codex path.
- Add a separate app-oriented path rather than regressing the CLI path.
- Treat filesystem layout and metadata ingestion as a translation layer.

### Validation

- Static parity check: generated Codex artifacts still satisfy current expectations
- New packaging/discovery test for the app-facing artifact shape
- Existing relevant tests:
  - `test/gen-skill-docs.test.ts`
  - `test/host-config.test.ts`

### Exit criteria

- The repo can generate an app-consumable Codex artifact set without relying on the current
  symlink-heavy install path
- No user-facing skill behavior changed yet

## Phase 2: Build The Parity Harness

### Objective

Measure parity by behavior, not by file movement.

### Why now

Once substrate work begins, you need objective checks before porting deeper runtime behavior.

### Parity lanes to add

1. Generation parity
2. Skill discovery parity
3. Routing invocation parity
4. Learnings read/write parity
5. Browser command parity
6. Real-browser/manual-cookie parity

### File targets

- `test/gen-skill-docs.test.ts`
- `test/codex-e2e.test.ts`
- `test/skill-routing-e2e.test.ts`
- `test/learnings.test.ts`
- `test/learnings-injection.test.ts`
- `test/skill-e2e-learnings.test.ts`
- browser tests under `browse/test/`
- likely new:
  - Codex-app-specific fixture runner(s)
  - parity smoke test(s) for app-consumable artifact sets

### Implementation notes

- Keep tests narrow and evidence-driven.
- Reuse existing tests as much as possible before inventing new frameworks.
- Add app-specific tests alongside existing CLI tests rather than replacing them.

### Validation

- Test-only phase

### Exit criteria

- Every later implementation phase can point at one or more concrete automated parity checks

## Phase 3: Port Routing And Session Substrate

### Objective

Preserve gstack’s skill-routing behavior in Codex app without relying on `CLAUDE.md`,
shell checks, or repo mutation as the routing mechanism.

### Why before memory and browser

Routing is the entrypoint behavior. If routing quality regresses, the rest of the port
will look broken even if individual skills work.

### Scope

- Move routing reinforcement out of Claude-specific `CLAUDE.md` assumptions
- Preserve:
  - strong skill invocation behavior
  - preamble guidance shape
  - project-scoped session behavior where applicable

### File targets

- `scripts/resolvers/preamble.ts`
- `scripts/resolvers/types.ts`
- `scripts/resolvers/index.ts`
- `codex/SKILL.md.tmpl`
- likely new:
  - Codex-app routing adapter/config files
  - session-state abstraction for Codex app host behavior

### Implementation notes

- Treat current preamble text as the behavior spec, not the mechanism spec.
- If the app exposes its own routing hooks or configuration surface, map the behavior there.
- Do not start rewording skills for weaker routing; fix the host substrate instead.

### Validation

- `test/skill-routing-e2e.test.ts`
- targeted Codex host tests for preamble/routing behavior

### Exit criteria

- Codex app can reliably route into the intended gstack skills without relying on `CLAUDE.md`

## Phase 4: Port Learnings And Durable Memory

### Objective

Preserve durable cross-session learnings and cross-skill memory behavior with a Codex-app-native
storage and execution path.

### Scope

- Preserve:
  - append-only learnings semantics
  - latest-wins dedup
  - project scoping
  - preamble load of prior learnings
  - review/plan-gap logging
- Replace:
  - shell-only binary assumptions
  - Claude-path hardcoding
  - temp-file-driven local logging where the app offers a better persistence seam

### File targets

- `learn/SKILL.md.tmpl`
- `scripts/resolvers/learnings.ts`
- `scripts/resolvers/preamble.ts`
- `scripts/resolvers/review.ts`
- `scripts/resolvers/review-army.ts`
- `hosts/codex.ts`
- likely new:
  - Codex-app learnings adapter/persistence helper
  - memory/log abstraction shared by Codex-hosted skills

### Implementation notes

- Keep the data model stable unless the app forces a schema adapter.
- Confirm whether `learningsMode` becomes a real runtime switch or should be removed in favor of
  an explicit adapter contract.

### Validation

- `test/learnings.test.ts`
- `test/learnings-injection.test.ts`
- `test/skill-e2e-learnings.test.ts`
- new app-specific persistence smoke tests

### Exit criteria

- Learnings behave the same from the user’s perspective in Codex app as they do in the CLI path

## Phase 5: Port Browser Command Runtime

### Objective

Preserve browser automation behavior while replacing the CLI daemon and real-browser substrate
where the Codex app cannot host it directly.

### Why later

This is the highest-risk rewrite boundary and should not be attempted before install,
routing, and memory substrate are stable.

### Split the work

#### Phase 5A: Command parity

Preserve the browser command/ref protocol first.

#### Phase 5B: Headless runtime substrate

Decide whether the app:

- hosts the current helper model
- wraps the current helper model
- or replaces it with an app-native browser substrate

#### Phase 5C: Real-browser/cookie flows

Recreate:

- cookie import
- persistent session behavior
- real-browser handoff semantics
- any user-visible “open browser” flow the CLI version exposes

### File targets

- `browse/src/commands.ts`
- `browse/src/cli.ts`
- `browse/src/server.ts`
- `browse/src/browser-manager.ts`
- `browse/src/find-browse.ts`
- `browse/src/cookie-import-browser.ts`
- `open-gstack-browser/SKILL.md.tmpl`
- `setup-browser-cookies/SKILL.md.tmpl`
- browser tests under `browse/test/`

### Implementation notes

- Preserve command semantics even if the runtime transport changes.
- Identify and isolate session persistence into a real seam if it is currently split.
- Expect the real-browser mode to require the most app-specific design work.

### Validation

- existing browser tests
- new browser command smoke tests
- new real-browser/manual-cookie parity checks

### Exit criteria

- Browser skills preserve the current user-facing workflows in Codex app
- The chosen runtime shape is documented and test-backed

## Phase 6: Restore Cross-Skill Parity

### Objective

Revisit the Codex-hosted suppressions and restore any behaviors that were only omitted because the
CLI Codex path could not safely self-invoke them, not because the product should lose them.

### Scope

Review the current suppressions in `hosts/codex.ts`:

- `DESIGN_OUTSIDE_VOICES`
- `ADVERSARIAL_STEP`
- `CODEX_SECOND_OPINION`
- `CODEX_PLAN_REVIEW`
- `REVIEW_ARMY`
- GBRAIN load/save

### Decision framework

For each suppression:

1. keep suppressed permanently for safety/product reasons
2. restore through an app-native backend path
3. replace with an equivalent Codex-app workflow

### File targets

- `hosts/codex.ts`
- `scripts/resolvers/design.ts`
- `scripts/resolvers/review.ts`
- `scripts/resolvers/review-army.ts`
- any new Codex-app orchestration/backend helpers introduced earlier

### Validation

- targeted resolver tests
- Codex host workflow tests
- manual parity review against audit expectations

### Exit criteria

- The remaining behavior differences between CLI and Codex app are intentional and documented,
  not accidental gaps

## Phase 7: Docs, Validation, And Release Readiness

### Objective

Close the loop: docs, tests, parity evidence, and operator guidance.

### Scope

- Update user-facing install/setup docs for the Codex app path
- Keep CLI documentation correct
- Document the plugin/app packaging shape
- Add an implementation status table back to the design docs if useful

### File targets

- `README.md`
- `ARCHITECTURE.md`
- `BROWSER.md`
- relevant `docs/designs/*.md`
- possibly new Codex-app-specific docs

### Validation

- relevant tests for touched files/flows
- manual docs sanity review against the final implementation
- `git diff --check`

### Exit criteria

- A new contributor can understand:
  - how the Codex app path works
  - what differs from the CLI path
  - what was intentionally preserved

## First Three Concrete Batches

If work starts immediately, I would sequence the next three implementation batches like this.

### Batch 1: Codex artifact/export substrate

#### Goal

Produce an app-consumable Codex artifact set without breaking current CLI Codex generation.

#### Likely files

- `scripts/gen-skill-docs.ts`
- `scripts/host-config.ts`
- `hosts/codex.ts`
- new Codex export/packaging helper(s)

#### Validation

- `test/gen-skill-docs.test.ts`
- `test/host-config.test.ts`

### Batch 2: Routing substrate

#### Goal

Replace `CLAUDE.md`-dependent routing reinforcement for Codex app behavior.

#### Likely files

- `scripts/resolvers/preamble.ts`
- `scripts/resolvers/types.ts`
- Codex-app routing adapter/config files

#### Validation

- `test/skill-routing-e2e.test.ts`
- targeted Codex host tests

### Batch 3: Learnings substrate

#### Goal

Make Codex app learnings durable and host-native while preserving current behavior.

#### Likely files

- `learn/SKILL.md.tmpl`
- `scripts/resolvers/learnings.ts`
- `scripts/resolvers/review.ts`
- Codex-app persistence helper(s)

#### Validation

- `test/learnings.test.ts`
- `test/learnings-injection.test.ts`
- `test/skill-e2e-learnings.test.ts`

## Risks To Watch Throughout

### Product risk

- Accidentally shipping a reduced Codex subset while calling it parity

### Technical risk

- Replacing generation or templates when the real issue is the host substrate

### Validation risk

- Declaring parity based on static generation tests alone

### UX risk

- Porting skills without recreating strong routing and memory behavior

### Browser risk

- Underestimating the real-browser rewrite surface

## Decision Log For The Next Turn

If implementation starts in the next turn, the first decision to make should be:

`What is the Codex-app-native artifact and discovery model for generated gstack skills?`

That one decision controls the shape of:

- setup replacement
- metadata handling
- runtime-root access
- later routing and memory adapters

Until that is answered, feature-by-feature rewrites will be premature.
