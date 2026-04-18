#!/usr/bin/env bun
import * as fs from 'fs';
import * as path from 'path';
import { getHostConfig } from '../hosts/index';

const ROOT = path.resolve(import.meta.dir, '..');
const HOST = 'codex';
const hostConfig = getHostConfig(HOST);
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

if (!hostConfig.appExport) {
  throw new Error('Codex host is missing appExport configuration');
}

const exportRoot = path.join(ROOT, hostConfig.appExport.root);
const pluginRoot = path.resolve(process.env.GSTACK_CODEX_PLUGIN_ROOT ?? path.join(ROOT, 'plugins', 'gstack'));
const pluginManifestPath = path.join(pluginRoot, '.codex-plugin', 'plugin.json');
const marketplacePath = path.resolve(
  process.env.GSTACK_CODEX_MARKETPLACE_PATH ?? path.join(ROOT, '.agents', 'plugins', 'marketplace.json'),
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

function syncDirectory(source: string, destination: string): void {
  ensureExists(source, 'plugin export source');
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, force: true });
}

const exportedSkillRoot = path.join(exportRoot, hostConfig.appExport.skillRoot);
const exportedRuntimeRoot = path.join(exportRoot, 'runtime');
const pluginSkillRoot = path.join(pluginRoot, 'skills');
const pluginRuntimeRoot = path.join(pluginRoot, 'runtime');

ensureExists(exportedSkillRoot, 'Codex app skill export');
ensureExists(exportedRuntimeRoot, 'Codex app runtime export');

syncDirectory(exportedSkillRoot, pluginSkillRoot);
syncDirectory(exportedRuntimeRoot, pluginRuntimeRoot);

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
        installation: 'AVAILABLE',
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
