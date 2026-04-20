/**
 * find-browse — locate the gstack browse binary.
 *
 * Compiled to browse/dist/find-browse (standalone binary, no bun runtime needed).
 * Outputs the absolute path to the browse binary on stdout, or exits 1 if not found.
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

function browseBinaryName(): string {
  return process.platform === 'win32' ? 'browse.exe' : 'browse';
}

function collectPluginRoots(home: string): string[] {
  const cacheRoot = join(home, '.codex', 'plugins', 'cache');
  if (!existsSync(cacheRoot)) return [];

  const roots: string[] = [];
  for (const marketplaceEntry of readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!marketplaceEntry.isDirectory()) continue;
    const marketplaceRoot = join(cacheRoot, marketplaceEntry.name);

    for (const pluginEntry of readdirSync(marketplaceRoot, { withFileTypes: true })) {
      if (!pluginEntry.isDirectory()) continue;
      const pluginRoot = join(marketplaceRoot, pluginEntry.name);
      if (existsSync(join(pluginRoot, 'runtime', 'gstack'))) {
        roots.push(pluginRoot);
      }

      for (const versionEntry of readdirSync(pluginRoot, { withFileTypes: true })) {
        if (!versionEntry.isDirectory()) continue;
        const versionRoot = join(pluginRoot, versionEntry.name);
        if (existsSync(join(versionRoot, 'runtime', 'gstack'))) {
          roots.push(versionRoot);
        }
      }
    }
  }

  return roots;
}

// ─── Binary Discovery ───────────────────────────────────────────

function getGitRoot(): string | null {
  try {
    const proc = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (proc.exitCode !== 0) return null;
    return proc.stdout.toString().trim();
  } catch {
    return null;
  }
}

export function locateBinary(): string | null {
  const root = getGitRoot();
  const home = homedir();
  const markers = ['.codex', '.agents', '.claude'];
  const binaryName = browseBinaryName();

  // Workspace-local takes priority (for development)
  if (root) {
    for (const m of markers) {
      const local = join(root, m, 'skills', 'gstack', 'browse', 'dist', binaryName);
      if (existsSync(local)) return local;
    }
  }

  for (const pluginRoot of collectPluginRoots(home)) {
    const pluginBinary = join(pluginRoot, 'runtime', 'gstack', 'browse', 'dist', binaryName);
    if (existsSync(pluginBinary)) return pluginBinary;
  }

  // Global fallback
  for (const m of markers) {
    const global = join(home, m, 'skills', 'gstack', 'browse', 'dist', binaryName);
    if (existsSync(global)) return global;
  }

  return null;
}

// ─── Main ───────────────────────────────────────────────────────

function main() {
  const bin = locateBinary();
  if (!bin) {
    process.stderr.write('ERROR: browse binary not found. Run: cd <skill-dir> && ./setup\n');
    process.exit(1);
  }

  console.log(bin);
}

main();
