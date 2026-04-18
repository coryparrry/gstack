import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');

function makeTempPluginExportRoot(): { pluginRoot: string; marketplacePath: string; cleanup: () => void } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-codex-plugin-'));
  return {
    pluginRoot: path.join(tempRoot, 'plugins', 'gstack'),
    marketplacePath: path.join(tempRoot, '.agents', 'plugins', 'marketplace.json'),
    cleanup: () => fs.rmSync(tempRoot, { recursive: true, force: true }),
  };
}

describe('codex plugin export', () => {
  test('export-codex-plugin emits a local plugin bundle and marketplace entry', () => {
    const exportPaths = makeTempPluginExportRoot();

    try {
      const result = Bun.spawnSync(['bun', 'run', 'scripts/export-codex-plugin.ts'], {
        cwd: ROOT,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...process.env,
          GSTACK_CODEX_PLUGIN_ROOT: exportPaths.pluginRoot,
          GSTACK_CODEX_MARKETPLACE_PATH: exportPaths.marketplacePath,
        },
      });

      if (result.exitCode !== 0) {
        throw new Error(
          `export-codex-plugin failed with exit code ${result.exitCode}\nstdout:\n${result.stdout.toString()}\nstderr:\n${result.stderr.toString()}`
        );
      }

      const pluginManifestPath = path.join(exportPaths.pluginRoot, '.codex-plugin', 'plugin.json');
      const rootSkillPath = path.join(exportPaths.pluginRoot, 'skills', 'gstack', 'SKILL.md');
      const runtimeRoot = path.join(exportPaths.pluginRoot, 'runtime', 'gstack');

      expect(fs.existsSync(pluginManifestPath)).toBe(true);
      expect(fs.existsSync(exportPaths.marketplacePath)).toBe(true);
      expect(fs.existsSync(rootSkillPath)).toBe(true);
      expect(fs.existsSync(path.join(runtimeRoot, 'bin', 'gstack-slug'))).toBe(true);
      expect(fs.existsSync(path.join(runtimeRoot, 'review', 'checklist.md'))).toBe(true);

      const pluginManifest = JSON.parse(fs.readFileSync(pluginManifestPath, 'utf-8'));
      expect(pluginManifest.name).toBe('gstack');
      expect(pluginManifest.skills).toBe('./skills/');
      expect(pluginManifest.interface.displayName).toBe('gstack');
      expect(pluginManifest.interface.category).toBe('Coding');

      const marketplace = JSON.parse(fs.readFileSync(exportPaths.marketplacePath, 'utf-8'));
      expect(marketplace.plugins).toHaveLength(1);
      expect(marketplace.plugins[0]).toEqual({
        name: 'gstack',
        source: {
          source: 'local',
          path: './plugins/gstack',
        },
        policy: {
          installation: 'AVAILABLE',
          authentication: 'ON_INSTALL',
        },
        category: 'Coding',
      });
    } finally {
      exportPaths.cleanup();
    }
  }, 300_000);

  test('generated Codex skills prefer plugin runtime discovery before legacy skill install', () => {
    const rootSkillPath = path.join(ROOT, '.agents', 'skills', 'gstack', 'SKILL.md');
    const rootSkill = fs.readFileSync(rootSkillPath, 'utf-8');

    expect(rootSkill).toContain('GSTACK_SKILLS_ROOT');
    expect(rootSkill).toContain('.codex/plugins/cache/*/gstack/*');
    expect(rootSkill).toContain('$_GSTACK_PLUGIN_ROOT/runtime/gstack');
    expect(rootSkill).toContain('$_GSTACK_PLUGIN_ROOT/skills');
    expect(rootSkill).toContain('$GSTACK_SKILLS_ROOT/[skill-name]/SKILL.md');
    expect(rootSkill).toContain('$GSTACK_ROOT/gstack-upgrade/SKILL.md');
  });
});
