# ELVIRA deploy

Everything you need to run [ELVIRA](https://elvira.digital), the open-source digital library:
the catalog with lending, OCR, search by meaning, extraction and the reading assistant, its
portal, and nginx in front. On one server with Docker Compose (Ansible can set the whole server
up), with plain `docker run`, or on Kubernetes.

Follow this page from top to bottom and you have a running library.

## What is in here

| Path | What it is |
|---|---|
| `compose.yml` | Every container. The catalog always runs; the rest are **profiles** you switch on. |
| `.env.example` | Every setting, explained. Your copy, `.env`, holds your values and secrets. |
| `k8s/` | The same containers for Kubernetes: `base/` plus one Kustomize component per profile. |
| `docker/run.sh` | The catalog, PostgreSQL and Redis with plain `docker run`. |
| `nginx/` | nginx sites for the catalog and the portal (templates). |
| `readium/` | The LCP license server's config template and logging. |
| `ansible/` | A playbook that turns a fresh Debian or Ubuntu server into a running ELVIRA. |
| `generator/` | `npm run configure`: fills `.env` and `config/` from your choices in `elvira.json`. |

### Profiles

| Profile | Starts | Needs |
|---|---|---|
| `postgres` | PostgreSQL 18 with pgvector and pg_search | — (leave out to use your own) |
| `redis` | Redis, the task broker and cache | — (leave out to use your own) |
| `lending` | Readium LCP license server, lcpencrypt worker | — |
| `ocr` | OCR worker for scanned PDFs | develop channel, amd64 |
| `search` | Text Embeddings Inference (search by meaning) | develop channel, amd64 |
| `extraction` | analyzer, image, equation and text workers | develop channel, `search`, amd64 |
| `assistant` | Ollama for the reading assistant | ~25 GB of RAM for the default model |
| `mail` | MailDev, catches e-mails for testing | — |
| `telemetry` | Grafana with Tempo, Loki and Mimir | — |

The same names are the Kubernetes components in `k8s/components/`.

## 1. Make your copy

Click **Use this template** on GitHub (keep your copy private: it will hold your settings), or:

```sh
git clone https://github.com/EvilFlowersCatalog/deploy.git elvira && cd elvira
```

## 2. Choose

You need Node.js 20 or newer on the machine you configure from (your laptop is fine).

```sh
npm run configure -- --set domain=library.example.org --set portalDomain=portal.example.org
npm run configure -- --set lending=true          # any setting, any time
npm run configure -- --defaults                  # every setting and its default
```

Each run saves your choices to `elvira.json` (commit it) and writes:

- `.env`: every setting, with fresh secrets the first time. Later runs keep them.
- `config/`: the nginx sites, the license server's config, and a Kustomize overlay.

Prefer clicking? [elvira.digital/deploy](https://elvira.digital/deploy) offers the same choices
and downloads `elvira.json`; put it here and run `npm run configure`. Or skip the generator:
`cp .env.example .env` and edit it by hand.

Your DNS: point both names (catalog and portal) at the server.

## 3. Run

### A server, all of it: Ansible

From your machine, for a fresh Debian 12+ or Ubuntu 22.04+ server you can SSH into with sudo:

```sh
cp ansible/inventory.example.yml ansible/inventory.yml    # your server, e-mail, admin password
ansible-playbook -i ansible/inventory.yml ansible/site.yml
```

It installs Docker and nginx, copies this directory to `/opt/elvira`, starts the profiles from
`.env`, creates the first administrator, gets Let's Encrypt certificates for both names and
builds the portal. Run it again after any change; it only redoes what changed.

### By hand: Docker Compose

On the server, in this directory (Docker with Compose 2.20 or newer):

```sh
docker compose up -d --wait
docker compose exec evilflowers python3 manage.py createsuperuser
sudo cp config/nginx/catalog.conf /etc/nginx/conf.d/elvira-catalog.conf
sudo cp config/nginx/portal.conf /etc/nginx/conf.d/elvira-portal.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d library.example.org -d portal.example.org
```

The nginx site serves the admin assets from `/opt/elvira/static`: keep this directory there, or
set `installDir` and configure again.

### Plain Docker

The catalog with PostgreSQL and Redis, from the same `.env`:

```sh
docker/run.sh up
docker exec -it elvira-evilflowers python3 manage.py createsuperuser
```

Then nginx as above. For the other profiles use Docker Compose.

### Kubernetes

On a cluster you already have, with an ingress controller (the limits in `k8s/base` are
ingress-nginx's):

```sh
npm run configure -- --set target=k8s --set channel=develop
kubectl create namespace elvira
kubectl apply -k config/k8s
kubectl -n elvira exec -it deploy/evilflowers -- python3 manage.py createsuperuser
```

`config/k8s/kustomization.yaml` lists your components and makes the `elvira-env` Secret from
`.env`. Add an `ingressClassName` and TLS there for your cluster. The stable images do not serve
the admin assets on Kubernetes: use the develop channel, or serve `/static/` from your ingress.

## 4. After the first start

Sign in at `https://<catalog>/admin/` and create the first catalog. Then, for what you switched on:

**Portal.** Ansible builds it. By hand: clone
[elvira-portal](https://github.com/EvilFlowersCatalog/elvira-portal), set `ELVIRA_BASE_URL` to
`https://<catalog>` in `env/.env.production`, `npm ci && npm run build:prod`, and copy `dist/`
to `/var/www/elvira-portal`.

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
`readium/certs/` as `cert.pem` and `privkey.pem`, then
`npm run configure -- --set lcpCertificate=production` and start again. Readers set an LCP
passphrase in their profile before they borrow.

**E-mail.** With the `mail` profile, MailDev catches everything at `http://127.0.0.1:1080` on the
server (`ssh -L 1080:127.0.0.1:1080 server`). For real mail, `--set mail=smtp` with your server
and put its password in `EMAIL_HOST_PASSWORD`.

**Telemetry.** Grafana at `http://127.0.0.1:3000` on the server (admin / admin).

## Updating

```sh
git pull                    # the template's latest blocks (in your copy: merge from upstream)
npm run configure           # same choices, new defaults; your secrets stay
docker compose pull && docker compose up -d --wait     # or run the playbook again
```

## Development

```sh
npm test                    # generator and block consistency, no tools needed
npm run test:integration    # docker compose config, nginx -t, kustomize + kubeconform
npm run bundle              # after editing .env.example or a template
```

The web page at elvira.digital/deploy runs `generator/` from this repository's `main`.
