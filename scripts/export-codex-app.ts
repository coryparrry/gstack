#!/usr/bin/env bun
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getHostConfig } from '../hosts/index';

const ROOT = path.resolve(import.meta.dir, '..');
const HOST = 'codex';
const hostConfig = getHostConfig(HOST);

if (!hostConfig.appExport) {
  throw new Error('Codex host is missing appExport configuration');
}

const exportRoot = path.join(ROOT, hostConfig.appExport.root);
const skillRoot = path.join(exportRoot, hostConfig.appExport.skillRoot);
const runtimeRoot = path.join(exportRoot, hostConfig.appExport.runtimeRoot);
const manifestPath = path.join(exportRoot, hostConfig.appExport.manifestFile);

function ensureExists(targetPath: string, label: string): void {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Missing ${label}: ${targetPath}`);
  }
}

function ensureCodexRuntimeBuilt(): void {
  const browseDist = path.join(ROOT, 'browse', 'dist');
  const serverNodePath = path.join(browseDist, 'server-node.mjs');
  const bunPolyfillPath = path.join(browseDist, 'bun-polyfill.cjs');
  if (fs.existsSync(browseDist) && fs.existsSync(serverNodePath) && fs.existsSync(bunPolyfillPath)) return;

  console.log('BUILDING: browse/dist');
  fs.mkdirSync(browseDist, { recursive: true });

  execSync('bun build browse/src/cli.ts --outfile browse/dist/browse --compile', {
    cwd: ROOT,
    stdio: 'inherit',
  });
  execSync('bun build browse/src/find-browse.ts --outfile browse/dist/find-browse --compile', {
    cwd: ROOT,
    stdio: 'inherit',
  });

  execSync(
    'bun build browse/src/server.ts --target=node --outfile browse/dist/server-node.mjs --external playwright --external playwright-core --external diff --external "bun:sqlite" --external "@ngrok/ngrok"',
    {
      cwd: ROOT,
      stdio: 'inherit',
    },
  );

  let serverBundle = fs.readFileSync(serverNodePath, 'utf-8');
  serverBundle = serverBundle.replaceAll('import.meta.dir', '__browseNodeSrcDir');
  serverBundle = serverBundle.replace(
    'import { Database } from "bun:sqlite";',
    'const Database = null; // bun:sqlite stubbed on Node',
  );

  const firstNewline = serverBundle.indexOf('\n');
  const header = [
    '// -- Windows Node.js compatibility (auto-generated) --',
    'import { fileURLToPath as _ftp } from "node:url";',
    'import { dirname as _dn } from "node:path";',
    'const __browseNodeSrcDir = _dn(_dn(_ftp(import.meta.url))) + "/src";',
    '{ const _r = createRequire(import.meta.url); _r("./bun-polyfill.cjs"); }',
    '// -- end compatibility --',
  ].join('\n');
  serverBundle =
    firstNewline === -1
      ? `${serverBundle}\n${header}\n`
      : `${serverBundle.slice(0, firstNewline + 1)}${header}\n${serverBundle.slice(firstNewline + 1)}`;
  fs.writeFileSync(serverNodePath, serverBundle);

  fs.copyFileSync(path.join(ROOT, 'browse', 'src', 'bun-polyfill.cjs'), bunPolyfillPath);
}

function copyEntry(fromRepoPath: string, toRuntimePath: string): void {
  const source = path.join(ROOT, fromRepoPath);
  ensureExists(source, 'runtime source');
  fs.mkdirSync(path.dirname(toRuntimePath), { recursive: true });
  fs.cpSync(source, toRuntimePath, { recursive: true, force: true });
}

function copyExportEntry(fromExportPath: string, toRuntimePath: string): void {
  const source = path.join(exportRoot, fromExportPath);
  ensureExists(source, 'exported skill source');
  fs.mkdirSync(path.dirname(toRuntimePath), { recursive: true });
  fs.cpSync(source, toRuntimePath, { recursive: true, force: true });
}

ensureExists(skillRoot, 'Codex app skill export');
ensureExists(manifestPath, 'Codex app manifest');
ensureCodexRuntimeBuilt();

fs.rmSync(runtimeRoot, { recursive: true, force: true });
fs.mkdirSync(runtimeRoot, { recursive: true });

copyExportEntry(path.join(hostConfig.appExport.skillRoot, 'gstack', 'SKILL.md'), path.join(runtimeRoot, 'SKILL.md'));
copyExportEntry(
  path.join(hostConfig.appExport.skillRoot, 'gstack', 'agents', 'openai.yaml'),
  path.join(runtimeRoot, 'agents', 'openai.yaml'),
);

for (const link of hostConfig.runtimeRoot.globalSymlinks) {
  copyEntry(link, path.join(runtimeRoot, link));
}

if (hostConfig.runtimeRoot.globalFiles) {
  for (const [dir, files] of Object.entries(hostConfig.runtimeRoot.globalFiles)) {
    for (const file of files) {
      copyEntry(path.join(dir, file), path.join(runtimeRoot, dir, file));
    }
  }
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
for (const asset of manifest.runtimeBundle?.assets || []) {
  ensureExists(path.join(exportRoot, manifest.runtimeBundle.path, asset), `runtime bundle asset ${asset}`);
}

console.log(`EXPORTED: ${path.relative(ROOT, runtimeRoot)}`);
