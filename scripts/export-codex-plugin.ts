#!/usr/bin/env bun
import * as fs from 'fs';
import * as path from 'path';
import { getHostConfig } from '../hosts/index';

const ROOT = path.resolve(import.meta.dir, '..');
const HOST = 'codex';
const hostConfig = getHostConfig(HOST);
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

function readOption(name: string): string | undefined {
  const prefix = `--${name}=`;
  const argv = Array.isArray((globalThis as { Bun?: { argv?: string[] } }).Bun?.argv)
    ? (globalThis as { Bun?: { argv?: string[] } }).Bun!.argv!
    : process.argv;
  const args = argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
    if (arg === `--${name}`) {
      return args[index + 1];
    }
  }
  return undefined;
}

function normalizeCliPath(inputPath: string): string {
  if (/^[A-Za-z]:[\\/]/.test(inputPath)) {
    return inputPath.replace(/\//g, '\\');
  }

  if (/^\/[A-Za-z]\//.test(inputPath)) {
    return `${inputPath[1]}:${inputPath.slice(2)}`.replace(/\//g, '\\');
  }

  if (/^\/mnt\/[A-Za-z]\//.test(inputPath)) {
    return `${inputPath[5]}:${inputPath.slice(6)}`.replace(/\//g, '\\');
  }

  return inputPath;
}

if (!hostConfig.appExport) {
  throw new Error('Codex host is missing appExport configuration');
}

const exportRoot = path.join(ROOT, hostConfig.appExport.root);
const pluginRoot = path.resolve(
  normalizeCliPath(
    readOption('plugin-root') ?? process.env.GSTACK_CODEX_PLUGIN_ROOT ?? path.join(ROOT, 'plugins', 'gstack')
  )
);
const pluginManifestPath = path.join(pluginRoot, '.codex-plugin', 'plugin.json');
const marketplacePath = path.resolve(
  normalizeCliPath(
    readOption('marketplace-path') ??
      process.env.GSTACK_CODEX_MARKETPLACE_PATH ??
      path.join(ROOT, '.agents', 'plugins', 'marketplace.json')
  ),
);

function ensureExists(targetPath: string, label: string): void {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Missing ${label}: ${targetPath}`);
  }
}

function writeJson(targetPath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`);
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
      const destinationSize = fs.statSync(destination).size;
      if (sourceStat.size === destinationSize) {
        console.warn(`SKIPPED_BUSY: ${path.relative(ROOT, destination)}`);
        return;
      }
    }
    throw error;
  }
}

function syncDirectory(source: string, destination: string): void {
  ensureExists(source, 'plugin export source');
  copyPathIncremental(source, destination);
}

const exportedSkillRoot = path.join(exportRoot, hostConfig.appExport.skillRoot);
const exportedRuntimeRoot = path.join(exportRoot, 'runtime');
const pluginSkillRoot = path.join(pluginRoot, 'skills');
const pluginRuntimeRoot = path.join(pluginRoot, 'runtime');
const pluginAssetsRoot = path.join(pluginRoot, 'assets');

ensureExists(exportedSkillRoot, 'Codex app skill export');
ensureExists(exportedRuntimeRoot, 'Codex app runtime export');

syncDirectory(exportedSkillRoot, pluginSkillRoot);
syncDirectory(exportedRuntimeRoot, pluginRuntimeRoot);

const extensionIcon48 = path.join(ROOT, 'extension', 'icons', 'icon-48.png');
const extensionIcon128 = path.join(ROOT, 'extension', 'icons', 'icon-128.png');
if (fs.existsSync(extensionIcon48) && fs.existsSync(extensionIcon128)) {
  fs.mkdirSync(pluginAssetsRoot, { recursive: true });
  copyPathIncremental(extensionIcon48, path.join(pluginAssetsRoot, 'composer-icon.png'));
  copyPathIncremental(extensionIcon128, path.join(pluginAssetsRoot, 'logo.png'));
}

const pluginManifest = {
  name: 'gstack',
  version: packageJson.version,
  description: 'gstack for the Codex app: full AI engineering workflow skills plus bundled runtime assets.',
  author: {
    name: 'gstack',
    url: 'https://github.com/garrytan/gstack',
  },
  homepage: 'https://github.com/garrytan/gstack',
  repository: 'https://github.com/garrytan/gstack',
  license: packageJson.license,
  keywords: [
    'gstack',
    'codex',
    'skills',
    'ai-engineering',
    'review',
    'qa',
    'browser',
  ],
  skills: './skills/',
  interface: {
    displayName: 'gstack',
    shortDescription: 'Full AI engineering workflow skills for the Codex app',
    longDescription: 'Use gstack in the Codex app with the same end-user workflow: planning, review, QA, browser automation, release flow, and learnings-backed runtime helpers.',
    developerName: 'gstack',
    category: 'Coding',
    capabilities: ['Interactive', 'Read', 'Write'],
    websiteURL: 'https://github.com/garrytan/gstack',
    privacyPolicyURL: 'https://github.com/garrytan/gstack',
    termsOfServiceURL: 'https://github.com/garrytan/gstack',
    defaultPrompt: [
      'Review this diff with gstack.',
      'Run gstack QA on this app flow.',
      'Plan and ship this feature with gstack.',
    ],
    brandColor: '#111111',
    composerIcon: './assets/composer-icon.png',
    logo: './assets/logo.png',
    screenshots: [],
  },
};

const marketplace = {
  name: 'gstack-local',
  interface: {
    displayName: 'Local gstack Plugins',
  },
  plugins: [
    {
      name: 'gstack',
      source: {
        source: 'local',
        path: './plugins/gstack',
      },
      policy: {
        installation: 'INSTALLED_BY_DEFAULT',
        authentication: 'ON_INSTALL',
      },
      category: 'Coding',
    },
  ],
};

writeJson(pluginManifestPath, pluginManifest);
writeJson(marketplacePath, marketplace);

console.log(`EXPORTED: ${path.relative(ROOT, pluginRoot).replace(/\\/g, '/')}`);
console.log(`EXPORTED: ${path.relative(ROOT, marketplacePath).replace(/\\/g, '/')}`);
