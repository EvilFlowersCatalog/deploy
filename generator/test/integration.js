#!/usr/bin/env node
/**
 * The generated files through the real tools, for every settings set in generator.test.js:
 *   docker compose config     compose.yml with the profiles and .env
 *   nginx -t                  config/nginx/*.conf in the official nginx image
 *   kustomize + kubeconform   config/k8s against the Kubernetes schemas (no cluster needed)
 * Needs Docker and kubectl. Writes each case into a copy of the repository under a temp dir.
 */
import {spawnSync} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {webcrypto} from 'node:crypto';

import {generate, generateSecrets} from '../src/index.js';
import {MATRIX} from './matrix.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const work = mkdtempSync(path.join(tmpdir(), 'elvira-deploy-'));
const secrets = await generateSecrets(webcrypto);
let failures = 0;

function run(cmd, args, input) {
  const r = spawnSync(cmd, args, {encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024});
  return {ok: r.status === 0, out: r.stdout ?? '', err: (r.stderr ?? '') + (r.error?.message ?? '')};
}

function check(name, what, r) {
  if (r.ok) return true;
  failures += 1;
  console.log(`FAIL ${name}: ${what}\n${r.err.trim().split('\n').slice(0, 15).join('\n')}`);
  return false;
}

for (const [name, partial] of Object.entries(MATRIX)) {
  const dir = path.join(work, name);
  cpSync(root, dir, {recursive: true, filter: (src) => !/\/(\.git|node_modules|config)(\/|$)|\/\.env$/.test(src)});
  const {files} = generate(partial, secrets);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), {recursive: true});
    writeFileSync(path.join(dir, file), text);
  }
  const done = [];

  if (check(name, 'docker compose config', run('docker', ['compose', '--project-directory', dir, 'config', '--quiet']))) done.push('compose');

  const confs = Object.keys(files).filter((f) => f.startsWith('config/nginx/'));
  const mounts = confs.flatMap((f) => ['-v', `${path.join(dir, f)}:/etc/nginx/conf.d/${path.basename(f)}:ro`]);
  if (check(name, 'nginx -t', run('docker', ['run', '--rm', ...mounts, 'nginx:1.29-alpine', 'nginx', '-t', '-q']))) done.push('nginx');

  const built = run('kubectl', ['kustomize', path.join(dir, 'config/k8s')]);
  if (check(name, 'kubectl kustomize', built)) {
    const valid = run('docker', ['run', '--rm', '-i', 'ghcr.io/yannh/kubeconform:v0.7.0', '-strict', '-summary', '-'], built.out);
    if (check(name, 'kubeconform', valid)) done.push(`k8s (${valid.out.trim()})`);
  }
  console.log(`ok   ${name}: ${done.join(', ')}`);
}

console.log(failures ? `\n${failures} failure(s)` : '\nall passed');
process.exit(failures ? 1 : 0);
