#!/usr/bin/env node
// The repository the way a user runs it, checked with the real tools in a temporary copy:
// scripts/setup.sh, then docker compose config with every profile, nginx -t on the written
// sites, and kustomize + kubeconform with every component. Pulls only small tool images.
import {spawnSync} from 'node:child_process';
import {cpSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(mkdtempSync(path.join(tmpdir(), 'elvira-deploy-')), 'repo');
cpSync(root, dir, {recursive: true, filter: (s) => !/\/(\.git|node_modules|static)(\/|$)|\/\.env$/.test(s)});

let failures = 0;
function step(what, cmd, args, input) {
  const r = spawnSync(cmd, args, {encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024});
  const ok = r.status === 0;
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `\n${(r.stderr || r.stdout || String(r.error)).trim().split('\n').slice(0, 15).join('\n')}`}`);
  return r;
}

step('scripts/setup.sh', path.join(dir, 'scripts/setup.sh'), []);

const all = readFileSync(path.join(dir, 'compose.yml'), 'utf8').match(/profiles: \[\w+\]/g).map((p) => p.slice(11, -1));
step(`docker compose config (profiles ${[...new Set(all)].join(',')})`, 'docker',
  ['compose', '--project-directory', dir, ...[...new Set(all)].flatMap((p) => ['--profile', p]), 'config', '--quiet']);

step('nginx -t', 'docker', ['run', '--rm',
  '-v', `${dir}/nginx/catalog.conf:/etc/nginx/conf.d/catalog.conf:ro`,
  '-v', `${dir}/nginx/portal.conf:/etc/nginx/conf.d/portal.conf:ro`,
  'nginx:1.29-alpine', 'nginx', '-t', '-q']);

// Every component on, as a user would uncomment them.
const k = path.join(dir, 'k8s/kustomization.yaml');
writeFileSync(k, readFileSync(k, 'utf8').replace(/^ {2}# - components\/(\w+).*$/gm, '  - components/$1'));
const built = step('kubectl kustomize (every component)', 'kubectl', ['kustomize', path.join(dir, 'k8s')]);
if (built.status === 0) {
  step('kubeconform -strict', 'docker', ['run', '--rm', '-i', 'ghcr.io/yannh/kubeconform:v0.7.0', '-strict', '-summary', '-'], built.stdout);
}

console.log(failures ? `\n${failures} failure(s)` : '\nall passed');
process.exit(failures ? 1 : 0);
