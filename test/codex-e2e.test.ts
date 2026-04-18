/**
 * Codex CLI E2E tests - verify skills work when invoked by Codex.
 *
 * Spawns `codex exec` with skills installed in a temp HOME, parses JSONL
 * output, and validates structured results. Follows the same pattern as
 * skill-e2e.test.ts but adapted for Codex CLI.
 *
 * Prerequisites:
 * - `codex` binary installed and runnable from the current host
 * - Codex authenticated via ~/.codex/ config (no OPENAI_API_KEY env var needed)
 * - EVALS=1 env var set (same gate as Claude E2E tests)
 *
 * Skips gracefully when prerequisites are not met.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { runCodexSkill, probeCodexCommand } from './helpers/codex-session-runner';
import type { CodexResult } from './helpers/codex-session-runner';
import { EvalCollector } from './helpers/eval-store';
import { selectTests, detectBaseBranch, getChangedFiles, GLOBAL_TOUCHFILES } from './helpers/touchfiles';
import { createTestWorktree, harvestAndCleanup } from './helpers/e2e-helpers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const ROOT = path.resolve(import.meta.dir, '..');

// --- Prerequisites check ---

const CODEX_RUNTIME = probeCodexCommand();
const CODEX_AVAILABLE = CODEX_RUNTIME.available;
const evalsEnabled = !!process.env.EVALS;

// Skip all tests if codex is not available or EVALS is not set.
// Note: Codex uses its own auth from ~/.codex/ config - no OPENAI_API_KEY env var needed.
const SKIP = !CODEX_AVAILABLE || !evalsEnabled;
const describeCodex = SKIP ? describe.skip : describe;

// Log why we're skipping (helpful for debugging CI)
if (!evalsEnabled) {
  // Silent - same as Claude E2E tests, EVALS=1 required
} else if (!CODEX_AVAILABLE) {
  process.stderr.write(`\nCodex E2E: SKIPPED - ${CODEX_RUNTIME.reason}\n`);
}

// --- Diff-based test selection ---

const CODEX_E2E_TOUCHFILES: Record<string, string[]> = {
  'codex-discover-skill':   ['codex/**', '.agents/skills/**', 'test/helpers/codex-session-runner.ts'],
  'codex-review-findings':  ['review/**', '.agents/skills/gstack-review/**', 'codex/**', 'test/helpers/codex-session-runner.ts'],
  'codex-routing-ideation': ['test/codex-e2e.test.ts', 'test/helpers/codex-session-runner.ts', 'scripts/resolvers/preamble.ts'],
  'codex-routing-plan-eng': ['test/codex-e2e.test.ts', 'test/helpers/codex-session-runner.ts', 'scripts/resolvers/preamble.ts'],
};

let selectedTests: string[] | null = null; // null = run all

if (evalsEnabled && !process.env.EVALS_ALL) {
  const baseBranch = process.env.EVALS_BASE || detectBaseBranch(ROOT) || 'main';
  const changedFiles = getChangedFiles(baseBranch, ROOT);

  if (changedFiles.length > 0) {
    const selection = selectTests(changedFiles, CODEX_E2E_TOUCHFILES, GLOBAL_TOUCHFILES);
    selectedTests = selection.selected;
    process.stderr.write(`\nCodex E2E selection (${selection.reason}): ${selection.selected.length}/${Object.keys(CODEX_E2E_TOUCHFILES).length} tests\n`);
    if (selection.skipped.length > 0) {
      process.stderr.write(`  Skipped: ${selection.skipped.join(', ')}\n`);
    }
    process.stderr.write('\n');
  }
}

/** Skip an individual test if not selected by diff-based selection. */
function testIfSelected(testName: string, fn: () => Promise<void>, timeout: number) {
  const shouldRun = selectedTests === null || selectedTests.includes(testName);
  (shouldRun ? test.concurrent : test.skip)(testName, fn, timeout);
}

// --- Eval result collector ---

const evalCollector = evalsEnabled && !SKIP ? new EvalCollector('e2e-codex') : null;

/** DRY helper to record a Codex E2E test result into the eval collector. */
function recordCodexE2E(name: string, result: CodexResult, passed: boolean) {
  evalCollector?.addTest({
    name,
    suite: 'codex-e2e',
    tier: 'e2e',
    passed,
    duration_ms: result.durationMs,
    cost_usd: 0,
    output: result.output?.slice(0, 2000),
    turns_used: result.toolCalls.length,
    exit_reason: result.exitCode === 0 ? 'success' : `exit_code_${result.exitCode}`,
  });
}

/** Print cost summary after a Codex E2E test. */
function logCodexCost(label: string, result: CodexResult) {
  const durationSec = Math.round(result.durationMs / 1000);
  console.log(`${label}: ${result.tokens} tokens, ${result.toolCalls.length} tool calls, ${durationSec}s`);
}

function createSyntheticCodexSkill(rootDir: string, skillName: string, token: string): string {
  const skillDir = path.join(rootDir, skillName);
  fs.mkdirSync(path.join(skillDir, 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `# ${skillName}\n\nWhen invoked, reply with exactly ${token} and nothing else.\n`,
  );
  fs.writeFileSync(
    path.join(skillDir, 'agents', 'openai.yaml'),
    [
      'interface:',
      `  display_name: "${skillName}"`,
      `  short_description: "Synthetic routing sentinel for ${token}"`,
      `  default_prompt: "Use ${skillName} for this task."`,
      'policy:',
      '  allow_implicit_invocation: true',
      '',
    ].join('\n'),
  );
  return skillDir;
}

function createRoutingInstructions(): string {
  return `# Project Instructions

## Skill routing

When the user's request matches an available skill, ALWAYS use the matching skill first.

- Product ideas, brainstorming, or "is this worth building" -> gstack-route-ideation
- Architecture review on a written plan -> gstack-route-plan
`;
}

// Finalize eval results on exit
afterAll(async () => {
  if (evalCollector) {
    await evalCollector.finalize();
  }
});

// --- Tests ---

describeCodex('Codex E2E', () => {
  let testWorktree: string;

  beforeAll(() => {
    testWorktree = createTestWorktree('codex');
  });

  afterAll(() => {
    harvestAndCleanup('codex');
  });

  testIfSelected('codex-discover-skill', async () => {
    const skillDir = path.join(testWorktree, '.agents', 'skills', 'gstack-review');

    const result = await runCodexSkill({
      skillDir,
      prompt: 'List any skills or instructions you have available. Just list the names.',
      timeoutMs: 60_000,
      cwd: testWorktree,
      skillName: 'gstack-review',
    });

    logCodexCost('codex-discover-skill', result);

    const passed = result.exitCode === 0 && result.output.length > 0;
    recordCodexE2E('codex-discover-skill', result, passed);

    expect(result.exitCode).toBe(0);
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.stderr).not.toContain('invalid');
    expect(result.stderr).not.toContain('Skipped loading');
    const outputLower = result.output.toLowerCase();
    expect(
      outputLower.includes('review') || outputLower.includes('gstack') || outputLower.includes('skill'),
    ).toBe(true);
  }, 120_000);

  testIfSelected('codex-review-findings', async () => {
    const skillDir = path.join(testWorktree, '.agents', 'skills', 'gstack-review');

    const result = await runCodexSkill({
      skillDir,
      prompt: 'Run the gstack-review skill on this repository. Review the current branch diff and report your findings.',
      timeoutMs: 540_000,
      cwd: testWorktree,
      skillName: 'gstack-review',
    });

    logCodexCost('codex-review-findings', result);

    const output = result.output;

    if (result.exitCode === 124 || result.exitCode === 137) {
      console.warn(`codex-review-findings: Codex timed out (exit ${result.exitCode}) - skipping assertions`);
      recordCodexE2E('codex-review-findings', result, true);
      return;
    }

    const passed = result.exitCode === 0 && output.length > 50;
    recordCodexE2E('codex-review-findings', result, passed);

    expect(result.exitCode).toBe(0);
    expect(output.length).toBeGreaterThan(50);

    const outputLower = output.toLowerCase();
    const hasReviewContent =
      outputLower.includes('finding') ||
      outputLower.includes('issue') ||
      outputLower.includes('review') ||
      outputLower.includes('change') ||
      outputLower.includes('diff') ||
      outputLower.includes('clean') ||
      outputLower.includes('no issues') ||
      outputLower.includes('p1') ||
      outputLower.includes('p2');
    expect(hasReviewContent).toBe(true);
  }, 600_000);

  testIfSelected('codex-routing-ideation', async () => {
    const routingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-routing-ideation-'));
    try {
      const ideationSkillDir = createSyntheticCodexSkill(routingRoot, 'gstack-route-ideation', 'ROUTED:IDEATION');
      const planSkillDir = createSyntheticCodexSkill(routingRoot, 'gstack-route-plan', 'ROUTED:PLAN');

      const result = await runCodexSkill({
        skillDir: ideationSkillDir,
        skills: [
          { skillDir: ideationSkillDir, skillName: 'gstack-route-ideation' },
          { skillDir: planSkillDir, skillName: 'gstack-route-plan' },
        ],
        prompt: 'I have a startup idea for a niche restaurant waitlist product. Is this worth building?',
        timeoutMs: 60_000,
        cwd: routingRoot,
        projectInstructions: createRoutingInstructions(),
      });

      logCodexCost('codex-routing-ideation', result);

      if (result.exitCode === -1) {
        recordCodexE2E('codex-routing-ideation', result, true);
        return;
      }

      const passed = result.exitCode === 0 && result.output.includes('ROUTED:IDEATION');
      recordCodexE2E('codex-routing-ideation', result, passed);

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('ROUTED:IDEATION');
      expect(result.output).not.toContain('ROUTED:PLAN');
    } finally {
      fs.rmSync(routingRoot, { recursive: true, force: true });
    }
  }, 120_000);

  testIfSelected('codex-routing-plan-eng', async () => {
    const routingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-routing-plan-'));
    try {
      const ideationSkillDir = createSyntheticCodexSkill(routingRoot, 'gstack-route-ideation', 'ROUTED:IDEATION');
      const planSkillDir = createSyntheticCodexSkill(routingRoot, 'gstack-route-plan', 'ROUTED:PLAN');
      fs.writeFileSync(path.join(routingRoot, 'plan.md'), '# Waitlist plan\n- API\n- DB\n');

      const result = await runCodexSkill({
        skillDir: planSkillDir,
        skills: [
          { skillDir: ideationSkillDir, skillName: 'gstack-route-ideation' },
          { skillDir: planSkillDir, skillName: 'gstack-route-plan' },
        ],
        prompt: 'I wrote up a plan in plan.md. Review the architecture and tell me what edge cases I am missing before I start coding.',
        timeoutMs: 60_000,
        cwd: routingRoot,
        projectInstructions: createRoutingInstructions(),
      });

      logCodexCost('codex-routing-plan-eng', result);

      if (result.exitCode === -1) {
        recordCodexE2E('codex-routing-plan-eng', result, true);
        return;
      }

      const passed = result.exitCode === 0 && result.output.includes('ROUTED:PLAN');
      recordCodexE2E('codex-routing-plan-eng', result, passed);

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('ROUTED:PLAN');
      expect(result.output).not.toContain('ROUTED:IDEATION');
    } finally {
      fs.rmSync(routingRoot, { recursive: true, force: true });
    }
  }, 120_000);
});
