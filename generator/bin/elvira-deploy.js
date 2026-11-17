#!/usr/bin/env node
/**
 * npm run configure: writes .env and config/ from elvira.json.
 *
 *   npm run configure                          elvira.json (created with defaults on first run)
 *   npm run configure -- --set lending=true    change a setting, save it to elvira.json, write
 *   npm run configure -- --defaults            print every setting and its default
 *
 * Secrets already in .env are kept, so running it again after a change is safe.
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {webcrypto} from 'node:crypto';

import {DEFAULTS, generate, generateSecrets, parseEnv, VERSION} from '../src/index.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const settingsFile = path.join(root, 'elvira.json');

function fail(message) {
  console.error(`configure: ${message}`);
  process.exit(2);
}

const set = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--defaults') {
    console.log(JSON.stringify(DEFAULTS, null, 2));
    process.exit(0);
  } else if (argv[i] === '--set' && argv[i + 1]) {
    const [k, ...v] = argv[++i].split('=');
    if (!(k in DEFAULTS)) fail(`unknown setting "${k}" (npm run configure -- --defaults lists them)`);
    const raw = v.join('=');
    set[k] = raw === 'true' ? true : raw === 'false' ? false : raw;
  } else {
    fail(`unknown argument "${argv[i]}"`);
  }
}

const saved = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, 'utf8')) : {};
for (const k of Object.keys(saved)) if (!(k in DEFAULTS)) fail(`elvira.json: unknown setting "${k}"`);

const envFile = path.join(root, '.env');
const keep = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
const secrets = await generateSecrets(webcrypto, keep);
// Keys you filled in by hand (API keys, SMTP and S3 credentials) survive too.
for (const k of ['EXTRACTION_API_KEY', 'EMAIL_HOST_PASSWORD', 'EVILFLOWERS_ASSISTANT_OLLAMA_API_KEY',
  'EVILFLOWERS_BACKUP_S3_ACCESS_KEY', 'EVILFLOWERS_BACKUP_S3_SECRET_KEY']) {
  if (keep[k]) secrets[k] = keep[k];
}

const {settings, notes, plan, files} = generate({...saved, ...set}, secrets);

// elvira.json keeps only what differs from the defaults: short, and readable in a diff.
const changed = Object.fromEntries(Object.entries(settings).filter(([k, v]) => DEFAULTS[k] !== v));
writeFileSync(settingsFile, `${JSON.stringify(changed, null, 2)}\n`);

for (const [name, text] of Object.entries(files)) {
  const target = path.join(root, name);
  mkdirSync(path.dirname(target), {recursive: true});
  const secret = name.endsWith('.env') || name.includes('readium/');
  writeFileSync(target, text, {mode: secret ? 0o600 : 0o644});
}

for (const n of notes) console.log(`note: ${n}`);
for (const w of plan.warnings) console.log(`warning: ${w}`);
console.log(`elvira-deploy ${VERSION}: profiles ${plan.profiles.join(', ') || '(none)'}; wrote ${Object.keys(files).join(', ')}`);
