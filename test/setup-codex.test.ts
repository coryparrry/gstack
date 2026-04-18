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

function createBashBunShim(rootDir: string): string {
  const whereResult = spawnSync('where.exe', ['bun'], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
  });
  if (whereResult.status !== 0) {
    throw new Error(`Unable to locate bun.exe\nstdout:\n${whereResult.stdout}\nstderr:\n${whereResult.stderr}`);
  }

  const bunWindowsPath = whereResult.stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean);
  if (!bunWindowsPath) {
    throw new Error('where.exe bun returned no path');
  }

  const bunShellPath = toShellPath(bunWindowsPath);
  const shimDir = path.join(rootDir, '.bun-shim');
  fs.mkdirSync(shimDir, { recursive: true });
  fs.writeFileSync(path.join(shimDir, 'bun'), `#!/usr/bin/env bash\nexec "${bunShellPath}" "$@"\n`);
  fs.writeFileSync(path.join(shimDir, 'bunx'), `#!/usr/bin/env bash\nexec "${bunShellPath}" x "$@"\n`);
  fs.chmodSync(path.join(shimDir, 'bun'), 0o755);
  fs.chmodSync(path.join(shimDir, 'bunx'), 0o755);
  return toShellPath(shimDir);
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

function collectNamedFiles(rootPath: string, fileName: string): string[] {
  const matches: string[] = [];

  function visit(currentPath: string, relativePath = ''): void {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const nextRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      const nextPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        visit(nextPath, nextRelative);
        continue;
      }

      if (entry.name === fileName) {
        matches.push(nextRelative);
      }
    }
  }

  visit(rootPath);
  return matches.sort();
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
      for (const binary of [
        'gstack-slug',
        'gstack-learnings-search',
        'gstack-learnings-log',
        'gstack-timeline-log',
      ]) {
        expect(fs.existsSync(path.join(exportedRootDir, 'bin', binary))).toBe(true);
      }
      expect(
        collectNamedFiles(exportedRootDir, 'openai.yaml')
      ).toEqual(['agents/openai.yaml']);
      expect(
        collectNamedFiles(exportedRootDir, 'SKILL.md')
      ).toEqual(['SKILL.md', 'gstack-upgrade/SKILL.md']);
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

  test('installed Codex runtime can write and read learnings and timeline state', () => {
    const tempHome = mkTmpHome();
    const codexHome = path.join(tempHome, '.codex');
    const gstackHome = path.join(tempHome, '.gstack');
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-codex-runtime-'));
    const shellCodexHome = toShellPath(codexHome);
    const shellGstackHome = toShellPath(gstackHome);

    const run = (cmd: string, args: string[]) =>
      spawnSync(cmd, args, { cwd: workDir, encoding: 'utf-8', timeout: 30_000 });

    try {
      const setupResult = spawnSync('bash', ['-lc', `CODEX_HOME='${shellCodexHome}' GSTACK_SKIP_COREUTILS=1 GSTACK_SKIP_PLAYWRIGHT_SETUP=1 ./setup --host codex -q`], {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 240_000,
      });
      expect(setupResult.status).toBe(0);

      expect(run('git', ['init', '-b', 'main']).status).toBe(0);
      expect(run('git', ['config', 'user.email', 'test@example.com']).status).toBe(0);
      expect(run('git', ['config', 'user.name', 'Test User']).status).toBe(0);
      fs.writeFileSync(path.join(workDir, 'app.ts'), 'console.log("hello");\n');
      expect(run('git', ['add', '.']).status).toBe(0);
      expect(run('git', ['commit', '-m', 'initial']).status).toBe(0);

      const codexGstack = path.join(codexHome, 'skills', 'gstack');
      const slugBin = readShellRealPath(path.join(codexGstack, 'bin', 'gstack-slug'));
      const learningsLogBin = readShellRealPath(path.join(codexGstack, 'bin', 'gstack-learnings-log'));
      const learningsSearchBin = readShellRealPath(path.join(codexGstack, 'bin', 'gstack-learnings-search'));
      const bunShimDir = createBashBunShim(tempHome);
      const bashEnv = { ...process.env };

      expect(slugBin).toBeTruthy();
      expect(learningsLogBin).toBeTruthy();
      expect(learningsSearchBin).toBeTruthy();

      const slugResult = spawnSync('bash', ['-lc', `GSTACK_HOME='${shellGstackHome}' '${slugBin!}'`], {
        cwd: workDir,
        encoding: 'utf-8',
        timeout: 30_000,
        env: bashEnv,
      });
      expect(slugResult.status).toBe(0);
      const slug = slugResult.stdout.match(/SLUG=(.*)/)?.[1]?.trim();
      expect(slug).toBeTruthy();

      const learnResult = spawnSync('bash', ['-lc', `PATH='${bunShimDir}:$PATH' GSTACK_HOME='${shellGstackHome}' '${learningsLogBin!}' '{"skill":"learn","type":"pattern","key":"codex-runtime-learnings","insight":"Installed Codex runtime writes project learnings through GSTACK_HOME.","confidence":9,"source":"observed"}'`], {
        cwd: workDir,
        encoding: 'utf-8',
        timeout: 30_000,
        env: bashEnv,
      });
      expect(learnResult.status).toBe(0);

      const searchResult = spawnSync('bash', ['-lc', `PATH='${bunShimDir}:$PATH' GSTACK_HOME='${shellGstackHome}' '${learningsSearchBin!}' --query 'codex-runtime-learnings' --limit 5`], {
        cwd: workDir,
        encoding: 'utf-8',
        timeout: 30_000,
        env: bashEnv,
      });
      expect(searchResult.status).toBe(0);
      expect(searchResult.stdout).toContain('codex-runtime-learnings');
      expect(searchResult.stdout).toContain('Installed Codex runtime writes project learnings through GSTACK_HOME.');

      const projectDir = path.join(gstackHome, 'projects', slug!);
      expect(fs.existsSync(path.join(projectDir, 'learnings.jsonl'))).toBe(true);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  }, 300_000);
});
