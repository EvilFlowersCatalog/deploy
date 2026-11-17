# ELVIRA deploy

Everything you need to run [ELVIRA](https://elvira.digital), the open-source digital library:
the catalog with lending, OCR, search by meaning, extraction and the reading assistant, its
portal, and nginx in front. On one server with Docker Compose (Ansible can set the whole server
up), with plain `docker run`, or on Kubernetes.

The quickest start is [elvira.digital/deploy](https://elvira.digital/deploy): pick your features
and download the finished files (compose.yml, .env with fresh secrets, the nginx sites). This
repository is where those files come from, and the way to run ELVIRA by hand.

## What is in here

| Path | What it is |
|---|---|
| `compose.yml` | Every container. The catalog always runs; the rest are **profiles** you switch on. |
| `.env.example` | Every setting, explained. Your copy, `.env`, holds your values and secrets. |
| `scripts/setup.sh` | Makes the secrets in `.env` and writes the nginx and license-server files from it. |
| `k8s/` | The same containers for Kubernetes: `base/`, one component per profile, and `kustomization.yaml`. |
| `docker/run.sh` | The catalog, PostgreSQL and Redis with plain `docker run`. |
| `nginx/` | nginx sites for the catalog and the portal (templates). |
| `readium/` | The license server's config template and logging. |
| `ansible/` | A playbook that turns a fresh Debian or Ubuntu server into a running ELVIRA. |

### Profiles

| Profile | Starts | Needs |
|---|---|---|
| `postgres` | PostgreSQL 18 with pgvector and pg_search | — (leave out to use your own) |
| `redis` | Redis, the task broker and cache | — (leave out to use your own) |
| `lending` | Readium LCP license server, lcpencrypt worker | — |
| `ocr` | OCR worker for scanned PDFs | develop images, amd64 |
| `search` | Text Embeddings Inference (search by meaning) | develop images, amd64 |
| `extraction` | analyzer, image, equation and text workers | develop images, `search`, amd64 |
| `assistant` | Ollama for the reading assistant | ~25 GB of RAM for the default model |
| `mail` | MailDev, catches e-mails for testing | — |
| `telemetry` | Grafana with Tempo, Loki and Mimir | — |

The same names are the Kubernetes components in `k8s/components/`.

## 1. Configure

```sh
git clone https://github.com/EvilFlowersCatalog/deploy.git elvira && cd elvira
cp .env.example .env
```

In `.env`, set your addresses (the catalog and portal names appear in the *addresses* section)
and `COMPOSE_PROFILES`. For the develop images, change `:master` to `:develop` in the two image
lines and turn on the features in their sections (each says what to set). Then:

```sh
scripts/setup.sh
```

It fills in every `change-me` secret (and keeps them on later runs), and writes
`nginx/catalog.conf`, `nginx/portal.conf`, `readium/config.yaml` and `readium/htpasswd` from
`.env`. Run it again whenever you edit `.env`. It needs openssl and Docker.

Point both names (catalog and portal) at your server.

## 2. Run

### A server, all of it: Ansible

From your machine, for a fresh Debian 12+ or Ubuntu 22.04+ server you can SSH into with sudo:

```sh
cp ansible/inventory.example.yml ansible/inventory.yml    # your server, e-mail, admin password
ansible-playbook -i ansible/inventory.yml ansible/site.yml
```

It installs Docker and nginx, copies this directory to `ELVIRA_DIR` (`/opt/elvira`), starts the
profiles, creates the first administrator, gets Let's Encrypt certificates and builds the portal.
Run it again after any change; it only redoes what changed.

### By hand: Docker Compose

On the server, in this directory (Docker with Compose 2.20 or newer):

```sh
docker compose up -d --wait
docker compose exec evilflowers python3 manage.py createsuperuser
sudo cp nginx/catalog.conf /etc/nginx/conf.d/elvira-catalog.conf
sudo cp nginx/portal.conf /etc/nginx/conf.d/elvira-portal.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d library.example.org -d portal.example.org
```

nginx serves the admin assets from `ELVIRA_DIR/static`, so keep this directory there (or change
`ELVIRA_DIR` and run `scripts/setup.sh` again).

### Plain Docker

The catalog with PostgreSQL and Redis, from the same `.env`:

```sh
docker/run.sh up
docker exec -it elvira-evilflowers python3 manage.py createsuperuser
```

Then nginx as above. For the other profiles use Docker Compose.

### Kubernetes

On a cluster you already have, with an ingress controller. Uncomment your components and set
your host name in `k8s/kustomization.yaml`, then from this directory:

```sh
kubectl create namespace elvira
kubectl -n elvira create secret generic elvira-env --from-env-file=.env
kubectl -n elvira create secret generic readium --from-file=readium/config.yaml --from-file=readium/htpasswd  # lending
kubectl apply -n elvira -k k8s
kubectl -n elvira exec -it deploy/evilflowers -- python3 manage.py createsuperuser
```

The stable images do not serve the admin assets on Kubernetes: use the develop images, or serve
`/static/` from your ingress.

## 3. After the first start

Sign in at `https://<catalog>/admin/` and create the first catalog. Then, for what you switched on:

**Portal.** Ansible builds it. By hand: clone
[elvira-portal](https://github.com/EvilFlowersCatalog/elvira-portal), build it with
`ELVIRA_BASE_URL=https://<catalog> npm run build:prod`, and copy `dist/` to `ELVIRA_PORTAL_ROOT`.

**Extraction.** The workers post their results as a service user. Make its key, put it in
`EXTRACTION_API_KEY` in `.env` and start again:

```sh
docker compose exec -T evilflowers python3 manage.py shell < scripts/extraction-api-key.py
docker compose up -d
docker compose exec evilflowers python3 manage.py backfill_extraction --missing   # existing PDFs
```

**Assistant.** Ollama starts empty: `docker compose exec ollama ollama pull qwen3.6:35b-a3b-q4_K_M`
(or the model you set).

**Lending.** It works out of the box with EDRLab's test certificate, which only test builds of
reading apps accept. For production, put the certificate and key EDRLab issued you in
`readium/certs/`, switch the three `ELVIRA_LCP_*` lines in `.env` as their comment shows, run
`scripts/setup.sh` and start again. Readers set an LCP passphrase in their profile before they
borrow.

**E-mail.** With the `mail` profile, MailDev catches everything at `http://127.0.0.1:1080` on the
server. For real mail, fill in the e-mail section of `.env`.

**Telemetry.** Grafana at `http://127.0.0.1:3000` on the server (admin / admin).

## Updating

```sh
git pull                    # the latest blocks (in your own copy: merge from upstream)
scripts/setup.sh            # your .env and secrets stay
docker compose pull && docker compose up -d --wait     # or run the playbook again
```

## Development

```sh
npm test                    # the blocks agree with each other, no tools needed
npm run test:integration    # setup.sh, docker compose config, nginx -t, kustomize + kubeconform
```

elvira.digital/deploy assembles its downloads from this repository's `main`: keep the layout of
`compose.yml` (a `profiles:` line per optional service) and of `.env.example`.
