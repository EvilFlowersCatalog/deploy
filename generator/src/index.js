/**
 * elvira-deploy's generator: elvira.json in, the files of this repository that depend on it out.
 *
 *   .env                          .env.example with your values, profiles and secrets
 *   config/readium/config.yaml    readium/config.yaml.tmpl filled in (lending)
 *   config/readium/htpasswd       the license servers' user
 *   config/nginx/catalog.conf     nginx/catalog.conf.tmpl filled in
 *   config/nginx/portal.conf      nginx/portal.conf.tmpl filled in (portal)
 *   config/k8s/kustomization.yaml an overlay of k8s/ with your components (Kubernetes)
 *
 * Everything else (compose.yml, k8s/, ansible/, docker/) is used as it is.
 */
import {DEFAULTS, IMAGES, PROFILES} from './data.js';
import {normalize} from './resolve.js';
import {TEMPLATES} from './templates.js';
import {VERSION} from './version.js';

export * from './data.js';
export {applyChange, isOn, normalize, requirementText} from './resolve.js';
export {generateSecrets, htpasswd, randomString, rsaJwk, SECRET_KEYS} from './secrets.js';
export {VERSION, GENERATOR} from './version.js';

/** Profiles (compose.yml) and components (k8s/components/) the settings switch on. */
export function profilesOf(s) {
  return [
    s.database === 'bundled' && 'postgres',
    s.redis === 'bundled' && 'redis',
    s.lending && 'lending',
    s.ocr && 'ocr',
    s.search === 'bundled' && 'search',
    s.extraction && 'extraction',
    s.assistant === 'bundled' && 'assistant',
    s.mail === 'catcher' && 'mail',
    s.telemetry === 'bundled' && 'telemetry',
  ].filter(Boolean);
}

/** Every .env value the settings decide, by key. Keys left out keep .env.example's value. */
export function envValues(s, secrets = {}) {
  const develop = s.channel === 'develop';
  const redisHost = s.redis === 'bundled' ? 'redis' : s.redisHost;
  const redisPort = s.redis === 'bundled' ? '6379' : s.redisPort;
  const broker = `redis://${redisHost}:${redisPort}/7`;
  const readiumUser = 'evilflowers';
  const readiumPassword = secrets.ELVIRA_READIUM_PASSWORD ?? 'change-me';
  const portalUrl = `https://${s.portalDomain}`;
  const embeddingUrl = {off: '', bundled: 'http://tei-embed', external: s.searchUrl}[s.search];

  return {
    COMPOSE_PROFILES: profilesOf(s).join(','),
    ELVIRA_CATALOG_IMAGE: develop ? IMAGES.catalog.develop : IMAGES.catalog.stable,
    ELVIRA_LCPENCRYPT_IMAGE: develop ? IMAGES.lcpencrypt.develop : IMAGES.lcpencrypt.stable,

    ELVIRA_DOMAIN: s.domain,
    ELVIRA_PORTAL_DOMAIN: s.portalDomain,
    ELVIRA_HTTP_BIND: s.target === 'docker' || s.target === 'compose' ? '127.0.0.1' : '0.0.0.0',
    INSTANCE_NAME: s.domain,
    ALLOWED_HOSTS: `${s.domain};evilflowers`,
    EVILFLOWERS_BASE_URL: `https://${s.domain}`,
    EVILFLOWERS_READIUM_BASE_URL: `https://${s.domain}`,
    EVILFLOWERS_PORTAL_URL: portalUrl,
    CORS_ALLOWED_ORIGINS: portalUrl,
    EVILFLOWERS_CONTACT_EMAIL: s.contactEmail,
    DEFAULT_FROM_EMAIL: s.contactEmail,

    PGHOST: s.database === 'bundled' ? 'postgres' : s.dbHost,
    PGPORT: s.database === 'bundled' ? '5432' : s.dbPort,
    PGDATABASE: s.dbName,
    PGUSER: s.dbUser,
    REDIS_HOST: redisHost,
    REDIS_PORT: redisPort,
    CELERY_BROKER_URL: broker,
    CELERY_RESULT_BACKEND: broker,

    EVILFLOWERS_MCP_ENABLED: s.mcp ? '1' : '0',

    ELVIRA_READIUM_USER: readiumUser,
    EVILFLOWERS_READIUM_LCPSV_URL: `http://${readiumUser}:${readiumPassword}@readium:8989`,
    EVILFLOWERS_READIUM_LSDSV_URL: `http://${readiumUser}:${readiumPassword}@readium:8990`,
    ELVIRA_LCP_CERTIFICATE: s.lcpCertificate,

    EVILFLOWERS_OCR_ENABLED: s.ocr ? 'true' : 'false',
    EVILFLOWERS_EMBEDDING_URL: embeddingUrl,
    EVILFLOWERS_EXTRACTION_ENABLED: s.extraction ? '1' : '0',

    EVILFLOWERS_ASSISTANT_ENABLED: s.assistant === 'off' ? '0' : '1',
    EVILFLOWERS_ASSISTANT_OLLAMA_ENDPOINT: s.assistant === 'external' ? s.assistantEndpoint : 'http://ollama:11434/api/chat',
    EVILFLOWERS_ASSISTANT_OLLAMA_MODEL: s.assistantModel,

    EVILFLOWERS_NOTIFICATIONS_ENABLED: s.mail === 'off' ? 'false' : 'true',
    EMAIL_HOST: {off: '', smtp: s.smtpHost, catcher: 'maildev'}[s.mail],
    EMAIL_PORT: s.mail === 'catcher' ? '1025' : s.smtpPort,
    EMAIL_USE_TLS: s.mail === 'catcher' ? 'false' : 'true',
    EMAIL_HOST_USER: s.mail === 'smtp' ? s.smtpUser : '',

    EVILFLOWERS_BACKUP_SCHEDULE: s.backup ? s.backupSchedule : '',
    EVILFLOWERS_BACKUP_DESTINATION: s.backupDestination,
    EVILFLOWERS_BACKUP_S3_HOST: s.backupS3Host,

    OTEL_SDK_DISABLED: s.telemetry === 'off' ? 'true' : 'false',
    OTEL_EXPORTER_OTLP_ENDPOINT: {off: '', bundled: 'http://otel-lgtm:4318', external: s.otlpEndpoint}[s.telemetry],

    ...secrets,
  };
}

/** .env.example with `KEY=value` lines replaced; comments, order and other keys stay. */
export function applyEnv(template, values) {
  const seen = new Set();
  const out = template.replace(/^([A-Z][A-Z0-9_]*)=.*$/gm, (line, key) => {
    if (!(key in values)) return line;
    seen.add(key);
    return `${key}=${values[key]}`;
  });
  const missing = Object.keys(values).filter((k) => !seen.has(k));
  if (missing.length) throw new Error(`.env.example has no line for ${missing.join(', ')}`);
  return out;
}

/** Parses an env file into {KEY: value} (unquoted values, as this repository writes them). */
export function parseEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** Fills `${NAME}` placeholders; a name without a value is an error, so nothing ships half-filled. */
export function render(template, vars) {
  return template.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (m, name) => {
    if (vars[name] === undefined) throw new Error(`no value for \${${name}}`);
    return vars[name];
  });
}

function kustomization(s, profiles) {
  const develop = s.channel === 'develop';
  const tag = develop ? 'develop' : 'master';
  return `# Generated by elvira-deploy ${VERSION} from elvira.json: npm run configure rewrites it.
# Apply with: kubectl apply -k config/k8s
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: ${s.namespace}

resources:
  - ../../k8s/base

components:
${profiles.map((p) => `  - ../../k8s/components/${p}`).join('\n') || '  []'}

# Every catalog setting and secret, from the same .env Compose reads.
secretGenerator:
  - name: elvira-env
    envs: [elvira.env]
${profiles.includes('lending') ? `  - name: readium
    files:
      - config.yaml=readium/config.yaml
      - htpasswd=readium/htpasswd
` : ''}
images:
  - name: ghcr.io/evilflowerscatalog/evilflowerscatalog
    newTag: ${tag}
  - name: ghcr.io/evilflowerscatalog/evilflowers-lcpencrypt-worker
    newTag: ${tag}

patches:
  - target: {kind: Ingress, name: evilflowers}
    patch: |-
      - op: replace
        path: /spec/rules/0/host
        value: ${s.domain}
${s.storageClass ? `  - target: {kind: PersistentVolumeClaim}
    patch: |-
      - op: add
        path: /spec/storageClassName
        value: ${s.storageClass}
` : ''}`;
}

function steps(s, profiles) {
  const out = [];
  if (s.target === 'compose') {
    out.push({
      title: 'Start it',
      body: `On a fresh Debian or Ubuntu server, the Ansible playbook installs Docker and nginx, starts these profiles${profiles.length ? ` (${profiles.join(', ')})` : ''}, issues certificates and builds the portal. By hand: docker compose up -d, then copy config/nginx/*.conf to /etc/nginx/conf.d/ and run certbot.`,
      commands: ['ansible-playbook -i ansible/inventory.yml ansible/site.yml', '# or by hand:', 'docker compose up -d --wait'],
    });
  } else if (s.target === 'docker') {
    out.push({
      title: 'Start it',
      body: 'docker/run.sh starts the catalog and, unless .env points elsewhere, PostgreSQL and Redis, with the same .env.',
      commands: ['docker/run.sh up'],
    });
  } else {
    out.push({
      title: 'Apply it',
      body: 'One overlay: the base, your components, and a Secret made from .env.',
      commands: [`kubectl create namespace ${s.namespace}`, 'kubectl apply -k config/k8s'],
    });
  }
  const exec =
    s.target === 'k8s' ? `kubectl -n ${s.namespace} exec -it deploy/evilflowers --` : s.target === 'docker' ? 'docker exec -it elvira-evilflowers' : 'docker compose exec evilflowers';
  out.push({
    title: 'Create the first administrator',
    body: 'Then sign in at /admin/ and create the first catalog.',
    commands: [`${exec} python3 manage.py createsuperuser`],
  });
  if (s.extraction) {
    out.push({
      title: 'Give the extraction workers an API key',
      body: 'Creates the extraction service user and prints its key. Put it in EXTRACTION_API_KEY in .env and start again.',
      commands: [`${exec.replace(' -it', ' -i')} python3 manage.py shell < scripts/extraction-api-key.py`],
    });
  }
  if (s.assistant === 'bundled') {
    out.push({
      title: 'Download the assistant model',
      body: `Ollama starts empty. Pull ${s.assistantModel} once.`,
      commands: [
        s.target === 'k8s'
          ? `kubectl -n ${s.namespace} exec deploy/ollama -- ollama pull ${s.assistantModel}`
          : `docker compose exec ollama ollama pull ${s.assistantModel}`,
      ],
    });
  }
  return out;
}

function warnings(s) {
  const out = [];
  if (s.database === 'external') {
    out.push('Your PostgreSQL needs the pgvector extension. With pg_search the catalog also ranks with BM25.');
  }
  if (s.lending && s.lcpCertificate === 'test') {
    out.push('Lending starts with EDRLab’s test certificate: only test builds of reading apps open its books. Put your own in readium/certs/ for production.');
  }
  if (s.target === 'k8s' && s.channel === 'stable') {
    out.push('On Kubernetes the stable images do not serve /static/, so /admin/ loads without its styles. The development images serve them themselves.');
  }
  if (s.portalDomain === s.domain) {
    out.push('The portal and the catalog need their own host names.');
  }
  return out;
}

/**
 * Builds the files. `secrets` are the values from secrets.js (`generateSecrets`) or an existing
 * .env, plus READIUM_HTPASSWD (the htpasswd line). A partial `partial` is resolved against the
 * defaults first, as the page resolves the same choices.
 */
export function generate(partial = {}, secrets = {}, {resolved = false} = {}) {
  const {settings: s, notes} = resolved ? {settings: partial, notes: []} : normalize(partial, DEFAULTS);
  const profiles = profilesOf(s);
  const {READIUM_HTPASSWD: htpasswdLine, ...envSecrets} = secrets;
  const values = envValues(s, envSecrets);
  const env = applyEnv(TEMPLATES['.env.example'], values);

  const vars = {
    ...values,
    ELVIRA_DIR: s.installDir.replace(/\/+$/, ''),
    ELVIRA_PORTAL_ROOT: s.portalRoot.replace(/\/+$/, ''),
    ELVIRA_READIUM_PASSWORD: envSecrets.ELVIRA_READIUM_PASSWORD ?? 'change-me',
    ELVIRA_LCP_PROFILE: s.lcpCertificate === 'production' ? '1.0' : 'basic',
    ELVIRA_LCP_CERT:
      s.lcpCertificate === 'production' ? '/usr/local/etc/readium/certs/cert.pem' : '/usr/local/var/readium/lcp/cert/cert-edrlab-test.pem',
    ELVIRA_LCP_KEY:
      s.lcpCertificate === 'production' ? '/usr/local/etc/readium/certs/privkey.pem' : '/usr/local/var/readium/lcp/cert/privkey-edrlab-test.pem',
  };

  const files = {'.env': env};
  files['config/nginx/catalog.conf'] = render(TEMPLATES['nginx/catalog.conf.tmpl'], vars);
  if (s.portal) files['config/nginx/portal.conf'] = render(TEMPLATES['nginx/portal.conf.tmpl'], vars);
  files['config/readium/config.yaml'] = render(TEMPLATES['readium/config.yaml.tmpl'], vars);
  files['config/readium/htpasswd'] = `${htpasswdLine ?? `${vars.ELVIRA_READIUM_USER}:change-me`}\n`;
  // Kustomize reads only files below the overlay, so it gets its own copies.
  files['config/k8s/kustomization.yaml'] = kustomization(s, profiles);
  files['config/k8s/elvira.env'] = env;
  if (s.lending) {
    files['config/k8s/readium/config.yaml'] = files['config/readium/config.yaml'];
    files['config/k8s/readium/htpasswd'] = files['config/readium/htpasswd'];
  }

  const services = [
    {name: 'evilflowers', role: 'core', feature: 'Catalog'},
    ...profiles.flatMap((p) => PROFILES[p].services.map((name) => ({name, role: PROFILES[p].role, feature: p}))),
  ];
  const plan = {services, profiles, steps: steps(s, profiles), warnings: warnings(s)};
  return {settings: s, notes, plan, files};
}
