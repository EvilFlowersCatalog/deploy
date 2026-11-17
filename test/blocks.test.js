// The blocks agree with each other: compose.yml, .env.example, the templates and k8s/.
// No tools needed: `npm test`.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

const envKeys = new Set([...read('.env.example').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));

/** compose.yml's service blocks: name → text. */
function composeServices() {
  const text = read('compose.yml').split(/^services:$/m)[1].split(/^volumes:$/m)[0];
  return Object.fromEntries([...text.matchAll(/^ {2}([a-z][a-z0-9-]*):\n((?: {4}.*\n|\s*\n)*)/gm)].map((m) => [m[1], m[2]]));
}

/** The flow list after `key:` in a block, as an array of strings. */
function flowList(block, key) {
  const m = block.match(new RegExp(`^\\s+${key}: \\[(.*)\\]$`, 'm'));
  return m ? m[1].split(/, (?=(?:[^"]*"[^"]*")*[^"]*$)/).map((s) => s.replace(/^"|"$/g, '')) : null;
}

const services = composeServices();
const profiles = {};
for (const [name, block] of Object.entries(services)) {
  for (const p of flowList(block, 'profiles') ?? []) (profiles[p] ??= []).push(name);
}

test('compose.yml: every ${VAR} it reads is in .env.example', () => {
  for (const [, name] of read('compose.yml').matchAll(/\$\{([A-Z_]+)(?::?[-?][^}]*)?\}/g)) {
    assert.ok(envKeys.has(name), `${name} missing from .env.example`);
  }
});

test('templates: every ${VAR} they read is in .env.example', () => {
  for (const f of ['nginx/catalog.conf.tmpl', 'nginx/portal.conf.tmpl', 'readium/config.yaml.tmpl']) {
    for (const [, name] of read(f).matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)) assert.ok(envKeys.has(name), `${f}: ${name}`);
  }
});

test('every profile has a k8s component with the same services, and the reverse', () => {
  const components = readdirSync(path.join(root, 'k8s/components'));
  assert.deepEqual([...components].sort(), Object.keys(profiles).sort());
  for (const [profile, names] of Object.entries(profiles)) {
    const k8s = read(`k8s/components/${profile}/${profile}.yaml`);
    for (const name of names) assert.match(k8s, new RegExp(`^  name: ${name}$`, 'm'), `${profile}: no ${name}`);
  }
});

test('workers run the same command on Compose and Kubernetes', () => {
  for (const [profile, names] of Object.entries(profiles)) {
    const k8s = read(`k8s/components/${profile}/${profile}.yaml`);
    for (const name of names) {
      const compose = flowList(services[name], 'command');
      if (!compose) continue;
      const deployment = k8s.split(/^---$/m).find((d) => d.includes('kind: Deployment') && d.includes(`  name: ${name}\n`));
      assert.deepEqual(flowList(deployment, 'args'), compose, `${name}: command differs`);
    }
  }
});

test('k8s/kustomization.yaml lists every component', () => {
  const k = read('k8s/kustomization.yaml');
  for (const p of Object.keys(profiles)) assert.match(k, new RegExp(`- components/${p}\\b`), p);
});

test('readium supervisord.conf is the same file in Kubernetes', () => {
  const inline = read('k8s/components/lending/lending.yaml').split('supervisord.conf: |\n')[1].split('\n---')[0].replace(/^ {4}/gm, '');
  assert.equal(inline.trim(), read('readium/supervisord.conf').trim());
});

test('the files compose.yml mounts are the ones setup.sh writes or the repository has', () => {
  const written = ['readium/config.yaml', 'readium/htpasswd'];
  for (const [, src] of read('compose.yml').matchAll(/^\s+- \.\/([^:]+):/gm)) {
    assert.ok(written.includes(src) || existsSync(path.join(root, src)) || src === 'static', `mount ./${src}`);
  }
});
