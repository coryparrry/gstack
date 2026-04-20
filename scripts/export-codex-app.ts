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

function newestMtimeMs(paths: string[]): number {
  return Math.max(...paths.filter(fs.existsSync).map(filePath => fs.statSync(filePath).mtimeMs), 0);
}

function filesMatch(source: string, destination: string): boolean {
  if (!fs.existsSync(destination)) return false;
  const sourceStat = fs.statSync(source);
  const destinationStat = fs.statSync(destination);
  return sourceStat.size === destinationStat.size && Math.trunc(sourceStat.mtimeMs) === Math.trunc(destinationStat.mtimeMs);
}

function copyPathIncremental(source: string, destination: string): void {
  const sourceStat = fs.statSync(source);
  if (sourceStat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyPathIncremental(path.join(source, entry), path.join(destination, entry));
    }
    return;
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (filesMatch(source, destination)) return;

  try {
    fs.copyFileSync(source, destination);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'EBUSY' && fs.existsSync(destination)) {
      const sourceSize = sourceStat.size;
      const destinationSize = fs.statSync(destination).size;
      if (sourceSize === destinationSize) {
        console.warn(`SKIPPED_BUSY: ${path.relative(ROOT, destination)}`);
        return;
      }
    }
    throw error;
  }
}

function ensureCodexRuntimeBuilt(): void {
  const browseDist = path.join(ROOT, 'browse', 'dist');
  const serverNodePath = path.join(browseDist, 'server-node.mjs');
  const bunPolyfillPath = path.join(browseDist, 'bun-polyfill.cjs');
  const browseBinaryPath = path.join(browseDist, process.platform === 'win32' ? 'browse.exe' : 'browse');
  const findBrowseBinaryPath = path.join(browseDist, process.platform === 'win32' ? 'find-browse.exe' : 'find-browse');
  const sourceInputs = [
    path.join(ROOT, 'browse', 'src', 'cli.ts'),
    path.join(ROOT, 'browse', 'src', 'find-browse.ts'),
    path.join(ROOT, 'browse', 'src', 'server.ts'),
    path.join(ROOT, 'browse', 'src', 'bun-polyfill.cjs'),
  ];
  const buildOutputs = [browseBinaryPath, findBrowseBinaryPath, serverNodePath, bunPolyfillPath];
  const outputsReady = buildOutputs.every(fs.existsSync);
  const sourcesMtime = newestMtimeMs(sourceInputs);
  const outputsMtime = newestMtimeMs(buildOutputs);
  if (outputsReady && outputsMtime >= sourcesMtime) return;

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
      ? `${header}\n${serverBundle}`
      : `${serverBundle.slice(0, firstNewline + 1)}${header}\n${serverBundle.slice(firstNewline + 1)}`;
  fs.writeFileSync(serverNodePath, serverBundle);

  fs.copyFileSync(path.join(ROOT, 'browse', 'src', 'bun-polyfill.cjs'), bunPolyfillPath);
}

function copyEntry(fromRepoPath: string, toRuntimePath: string): void {
  const source = path.join(ROOT, fromRepoPath);
  ensureExists(source, 'runtime source');
  copyPathIncremental(source, toRuntimePath);
}

function copyExportEntry(fromExportPath: string, toRuntimePath: string): void {
  const source = path.join(exportRoot, fromExportPath);
  ensureExists(source, 'exported skill source');
  copyPathIncremental(source, toRuntimePath);
}

function shouldNormalizeShellScript(filePath: string, content: string): boolean {
  const base = path.basename(filePath);
  if (base.endsWith('.sh')) return true;
  return content.startsWith('#!/usr/bin/env bash')
    || content.startsWith('#!/bin/bash')
    || content.startsWith('#!/usr/bin/env sh')
    || content.startsWith('#!/bin/sh');
}

function normalizeRuntimeShellScripts(rootPath: string): void {
  const stack = [rootPath];

  while (stack.length > 0) {
    const currentPath = stack.pop()!;
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const nextPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        stack.push(nextPath);
        continue;
      }

      const content = fs.readFileSync(nextPath, 'utf-8');
      if (!content.includes('\r\n')) continue;
      if (!shouldNormalizeShellScript(nextPath, content)) continue;
      fs.writeFileSync(nextPath, content.replace(/\r\n/g, '\n'));
    }
  }
}

ensureExists(skillRoot, 'Codex app skill export');
ensureExists(manifestPath, 'Codex app manifest');
ensureCodexRuntimeBuilt();

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

normalizeRuntimeShellScripts(runtimeRoot);

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
for (const asset of manifest.runtimeBundle?.assets || []) {
  ensureExists(path.join(exportRoot, manifest.runtimeBundle.path, asset), `runtime bundle asset ${asset}`);
}

console.log(`EXPORTED: ${path.relative(ROOT, runtimeRoot)}`);
