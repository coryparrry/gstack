import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const ROOT = path.resolve(import.meta.dir, '..');

function mkTmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-codex-setup-'));
}

function toShellPath(targetPath: string): string {
  const escapedPath = targetPath.replace(/\\/g, '/').replace(/'/g, `'\"'\"'`);
  const result = spawnSync('bash', ['-lc', `wslpath -u '${escapedPath}'`], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
  });

  if (result.status === 0) {
    return result.stdout.trim();
  }

  return targetPath.replace(/\\/g, '/');
}

function readShellRealPath(targetPath: string): string | null {
  const shellPath = toShellPath(targetPath).replace(/'/g, `'\"'\"'`);
  const result = spawnSync('bash', ['-lc', `if [ -L '${shellPath}' ] || [ -e '${shellPath}' ]; then readlink -f '${shellPath}'; fi`], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
  });

  if (result.status !== 0) {
    return null;
  }

  const resolved = result.stdout.trim();
  return resolved.length > 0 ? resolved : null;
}

function collectRuntimeBundleAssets(runtimeRoot: string, declaredAssets: string[]): string[] {
  const declared = new Set(declaredAssets);
  const collected = new Set<string>();

  function visit(currentPath: string, relativePath = ''): void {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const nextRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      const nextPath = path.join(currentPath, entry.name);

      if (declared.has(nextRelative)) {
        collected.add(nextRelative);
        continue;
      }

      if (entry.isDirectory()) {
        visit(nextPath, nextRelative);
        continue;
      }

      collected.add(nextRelative);
    }
  }

  visit(runtimeRoot);
  return [...collected].sort();
}

describe('setup --host codex', () => {
  test('installs Codex runtime and skills from the .codex-app bundle', () => {
    const tempHome = mkTmpHome();
    const codexHome = path.join(tempHome, '.codex');
    const shellCodexHome = toShellPath(codexHome);

    try {
      const result = spawnSync('bash', ['-lc', `CODEX_HOME='${shellCodexHome}' GSTACK_SKIP_COREUTILS=1 GSTACK_SKIP_PLAYWRIGHT_SETUP=1 ./setup --host codex -q`], {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 240_000,
      });

      if (result.status !== 0) {
        throw new Error(
          `setup failed with status ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
        );
      }

      expect(result.status).toBe(0);

      const manifestPath = path.join(ROOT, '.codex-app', 'manifest.json');
      expect(fs.existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(manifest.host).toBe('codex');
      expect(manifest.runtimeRoot).toBe('runtime/gstack');
      expect(
        fs.readdirSync(path.join(codexHome, 'skills')).sort()
      ).toEqual(
        manifest.skills.map((skill: { name: string }) => skill.name).sort()
      );

      for (const skill of manifest.skills as Array<{ name: string; metadataPath: string }>) {
        const installedMetadataPath = path.join(codexHome, 'skills', skill.name, 'agents', 'openai.yaml');
        const exportedMetadataPath = path.join(
          ROOT,
          '.codex-app',
          skill.name === 'gstack' ? manifest.runtimeBundle.metadataPath : skill.metadataPath
        );
        expect(readShellRealPath(installedMetadataPath)).toBe(toShellPath(exportedMetadataPath));
        expect(fs.readFileSync(exportedMetadataPath, 'utf-8').trim().length).toBeGreaterThan(0);
      }

      const installedRoot = path.join(codexHome, 'skills', 'gstack');
      const exportedRootDir = path.join(ROOT, '.codex-app', 'runtime', 'gstack');
      expect(
        collectRuntimeBundleAssets(exportedRootDir, manifest.runtimeBundle.assets)
      ).toEqual(
        [...manifest.runtimeBundle.assets].sort()
      );
      expect(readShellRealPath(installedRoot)).toBe(toShellPath(exportedRootDir));

      const installedReviewDir = path.join(codexHome, 'skills', 'gstack-review');
      const exportedReviewDir = path.join(ROOT, '.codex-app', 'skills', 'gstack-review');
      expect(readShellRealPath(installedReviewDir)).toBe(toShellPath(exportedReviewDir));
    } finally {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  }, 300_000);

  test('rejects Codex install roots that escape the declared Codex home', () => {
    const tempHome = mkTmpHome();
    const codexHome = path.join(tempHome, '.codex');
    const escapedGstack = path.join(tempHome, 'escaped-gstack');
    const shellCodexHome = toShellPath(codexHome);
    const shellEscapedGstack = toShellPath(escapedGstack);

    try {
      const result = spawnSync('bash', ['-lc', `CODEX_HOME='${shellCodexHome}' CODEX_GSTACK='${shellEscapedGstack}' GSTACK_SKIP_COREUTILS=1 GSTACK_SKIP_PLAYWRIGHT_SETUP=1 ./setup --host codex -q`], {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 60_000,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('unsafe CODEX_GSTACK path outside');
    } finally {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  }, 90_000);
});
