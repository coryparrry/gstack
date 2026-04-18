import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  installSkillsToTempHome,
  installSkillToTempHome,
  writeProjectAgentsMd,
} from './helpers/codex-session-runner';

function createTempSkill(rootDir: string, skillName: string, marker: string): string {
  const skillDir = path.join(rootDir, skillName);
  fs.mkdirSync(path.join(skillDir, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `# ${skillName}\n\n${marker}\n`);
  fs.writeFileSync(
    path.join(skillDir, 'agents', 'openai.yaml'),
    `interface:\n  display_name: "${skillName}"\npolicy:\n  allow_implicit_invocation: true\n`,
  );
  return skillDir;
}

describe('codex-session-runner helpers', () => {
  test('installSkillsToTempHome installs multiple skills with metadata', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-session-runner-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-session-home-'));
    try {
      const skillA = createTempSkill(root, 'skill-a', 'MARKER_A');
      const skillB = createTempSkill(root, 'skill-b', 'MARKER_B');

      installSkillsToTempHome(
        [
          { skillDir: skillA, skillName: 'route-a' },
          { skillDir: skillB, skillName: 'route-b' },
        ],
        home,
      );

      expect(fs.readFileSync(path.join(home, '.codex', 'skills', 'route-a', 'SKILL.md'), 'utf8')).toContain('MARKER_A');
      expect(fs.readFileSync(path.join(home, '.codex', 'skills', 'route-b', 'SKILL.md'), 'utf8')).toContain('MARKER_B');
      expect(fs.existsSync(path.join(home, '.codex', 'skills', 'route-a', 'agents', 'openai.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(home, '.codex', 'skills', 'route-b', 'agents', 'openai.yaml'))).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('installSkillToTempHome keeps single-skill helper behavior', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-session-runner-single-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-session-home-single-'));
    try {
      const skill = createTempSkill(root, 'skill-single', 'MARKER_SINGLE');

      installSkillToTempHome(skill, 'gstack-route-single', home);

      expect(fs.readFileSync(path.join(home, '.codex', 'skills', 'gstack-route-single', 'SKILL.md'), 'utf8')).toContain('MARKER_SINGLE');
      expect(fs.existsSync(path.join(home, '.codex', 'skills', 'gstack-route-single', 'agents', 'openai.yaml'))).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('writeProjectAgentsMd seeds project-level routing instructions', () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-session-project-'));
    try {
      const expected = '# Project Instructions\n\n## Skill routing\n\nRoute ideation to gstack-route-ideation.\n';
      const agentsPath = writeProjectAgentsMd(projectDir, expected);

      expect(agentsPath).toBe(path.join(projectDir, 'AGENTS.md'));
      expect(fs.readFileSync(agentsPath, 'utf8')).toBe(expected);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
