import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {DEFAULTS, PROFILES, VERSION, generate, generateSecrets, normalize, parseEnv, profilesOf} from '../src/index.js';
import {bundle} from '../bundle.js';
import {MATRIX} from './matrix.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const secrets = await generateSecrets(webcrypto);


test('templates.js matches the templates (npm run bundle)', () => {
  assert.equal(read('generator/src/templates.js'), bundle());
});

test('package.json and version.js agree', () => {
  assert.equal(JSON.parse(read('package.json')).version, VERSION);
});

for (const [name, partial] of Object.entries(MATRIX)) {
  test(`${name}: every file filled in`, () => {
    const {files} = generate(partial, secrets);
    for (const [file, text] of Object.entries(files)) {
      for (const bad of ['undefined', '[object Object]', '${ELVIRA']) assert.ok(!text.includes(bad), `${file}: ${bad}`);
    }
  });
}

test('.env: profiles, images and secrets', () => {
  const env = parseEnv(generate(MATRIX.everything, secrets).files['.env']);
  assert.equal(env.COMPOSE_PROFILES, 'postgres,redis,lending,ocr,search,extraction,assistant,mail,telemetry');
  assert.match(env.ELVIRA_CATALOG_IMAGE, /:develop$/);
  assert.equal(env.SECRET_KEY, secrets.SECRET_KEY);
  assert.equal(JSON.parse(env.SECURED_VIEW_JWK).kty, 'RSA');
  assert.ok(env.EVILFLOWERS_READIUM_LCPSV_URL.includes(secrets.ELVIRA_READIUM_PASSWORD));
  assert.equal(env.EVILFLOWERS_EMBEDDING_URL, 'http://tei-embed');
  assert.equal(env.EMAIL_HOST, 'maildev');
});

test('own PostgreSQL and Redis: no bundled profiles, their addresses in .env', () => {
  const {settings, files} = generate(MATRIX.external, secrets);
  assert.deepEqual(profilesOf(settings), []);
  const env = parseEnv(files['.env']);
  assert.equal(env.PGHOST, DEFAULTS.dbHost);
  assert.equal(env.CELERY_BROKER_URL, `redis://${DEFAULTS.redisHost}:${DEFAULTS.redisPort}/7`);
  assert.ok(!('config/nginx/portal.conf' in files));
});

test('secrets: kept from an existing .env, htpasswd matches the readium password', async () => {
  const again = await generateSecrets(webcrypto, {SECRET_KEY: 'kept', ELVIRA_READIUM_PASSWORD: 'pw'});
  assert.equal(again.SECRET_KEY, 'kept');
  // {SHA} of "pw": printf pw | openssl dgst -sha1 -binary | base64
  assert.equal(again.READIUM_HTPASSWD, 'evilflowers:{SHA}GpHWL3ymc5liWkNopqtdSjuqYHM=');
});

test('requirements: extraction switches on develop and the embedding service', () => {
  const {settings} = normalize({extraction: true}, DEFAULTS);
  assert.equal(settings.channel, 'develop');
  assert.equal(settings.search, 'bundled');
});

test('compose.yml: every ${VAR} it reads is in .env.example', () => {
  const env = parseEnv(read('.env.example'));
  for (const [, name] of read('compose.yml').matchAll(/\$\{([A-Z_]+)(?::?[-?][^}]*)?\}/g)) {
    assert.ok(name in env, `${name} missing from .env.example`);
  }
});

/** Each service block of compose.yml: name → its text. */
function composeServices() {
  const text = read('compose.yml').split(/^services:$/m)[1].split(/^volumes:$/m)[0];
  return Object.fromEntries([...text.matchAll(/^ {2}([a-z-]+):\n((?: {4}.*\n|\s*\n)*)/gm)].map((m) => [m[1], m[2]]));
}

/** The flow list after `key:` in a block, as an array of strings. */
function flowList(block, key) {
  const m = block.match(new RegExp(`^\\s+${key}: \\[(.*)\\]$`, 'm'));
  return m ? m[1].split(/, (?=(?:[^"]*"[^"]*")*[^"]*$)/).map((s) => s.replace(/^"|"$/g, '')) : null;
}

test('profiles: every service in compose.yml under its profile, and in its k8s component', () => {
  const services = composeServices();
  for (const [profile, {services: names}] of Object.entries(PROFILES)) {
    const dir = `k8s/components/${profile}`;
    assert.ok(existsSync(path.join(root, dir, 'kustomization.yaml')), `${dir} missing`);
    const k8s = readFileSync(path.join(root, dir, `${profile}.yaml`), 'utf8');
    for (const name of names) {
      assert.ok(services[name], `compose.yml has no service ${name}`);
      assert.deepEqual(flowList(services[name], 'profiles'), [profile], `${name} is not in profile ${profile}`);
      assert.match(k8s, new RegExp(`^  name: ${name}$`, 'm'), `${dir} has no ${name}`);
    }
  }
});

test('workers run the same command on Compose and Kubernetes', () => {
  const services = composeServices();
  for (const [profile, {services: names}] of Object.entries(PROFILES)) {
    const k8s = readFileSync(path.join(root, `k8s/components/${profile}/${profile}.yaml`), 'utf8');
    for (const name of names) {
      const compose = flowList(services[name], 'command');
      if (!compose) continue;
      const deployment = k8s.split(/^---$/m).find((d) => d.includes('kind: Deployment') && d.includes(`  name: ${name}\n`));
      assert.deepEqual(flowList(deployment, 'args'), compose, `${name}: command differs`);
    }
  }
});

test('readium supervisord.conf is the same file in Kubernetes', () => {
  const k8s = read('k8s/components/lending/lending.yaml');
  const inline = k8s.split('supervisord.conf: |\n')[1].split('\n---')[0].replace(/^ {4}/gm, '');
  assert.equal(inline.trim(), read('readium/supervisord.conf').trim());
});
