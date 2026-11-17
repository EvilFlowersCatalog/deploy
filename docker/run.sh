#!/bin/sh
# ELVIRA with plain docker run: the catalog, and PostgreSQL and Redis unless .env points at your
# own (PGHOST, REDIS_HOST). Same .env as Docker Compose. For lending, OCR, search, extraction and
# the rest, use Docker Compose (compose.yml): it is the same set of containers with profiles.
#
#   docker/run.sh up        start (or update) everything
#   docker/run.sh down      stop and remove the containers (volumes stay)
#   docker/run.sh status    what is running
set -eu

cd "$(dirname "$0")/.."
[ -f .env ] || { echo "No .env here: run scripts/setup.sh first." >&2; exit 1; }

# Values from .env, read line by line: the file is not shell syntax (the JWK holds braces).
env_value() { grep -E "^$1=" .env | tail -n 1 | cut -d= -f2-; }

PREFIX=elvira
NET=$PREFIX
IMAGE=$(env_value ELVIRA_CATALOG_IMAGE)
BIND=$(env_value ELVIRA_HTTP_BIND)

# run <service> <docker run options…> <image> [command…]: the container elvira-<service>, reachable
# as <service> on the network (the same names compose.yml uses).
run() {
  service=$1; shift
  docker rm -f "$PREFIX-$service" >/dev/null 2>&1 || true
  docker run -d --name "$PREFIX-$service" --network "$NET" --network-alias "$service" --restart unless-stopped "$@" >/dev/null
  echo "started $PREFIX-$service"
}

wait_healthy() {
  printf 'waiting for %s' "$1"
  until [ "$(docker inspect -f '{{.State.Health.Status}}' "$PREFIX-$1" 2>/dev/null)" = healthy ]; do
    printf .; sleep 2
  done
  echo
}

up() {
  docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
  if [ "$(env_value PGHOST)" = postgres ]; then
    run postgres \
      -e POSTGRES_DB="$(env_value PGDATABASE)" -e POSTGRES_USER="$(env_value PGUSER)" -e POSTGRES_PASSWORD="$(env_value PGPASSWORD)" \
      -v "$PREFIX-postgres:/var/lib/postgresql" --shm-size 1g \
      --health-cmd "pg_isready -h 127.0.0.1 -U $(env_value PGUSER)" --health-interval 5s \
      ghcr.io/evilflowerscatalog/evilflowers-postgresql:18
    wait_healthy postgres
  fi
  if [ "$(env_value REDIS_HOST)" = redis ]; then
    run redis -v "$PREFIX-redis:/data" --health-cmd "redis-cli ping" --health-interval 5s redis:7
    wait_healthy redis
  fi
  docker pull -q "$IMAGE" >/dev/null
  # Same as compose.yml: collect the admin assets into ./static, then the image's own start.
  run evilflowers --env-file .env \
    -p "${BIND:-127.0.0.1}:8000:8000" \
    -v "$PREFIX-data:/var/local/evilflowers" -v "$PWD/static:/usr/src/app/static" \
    "$IMAGE" /bin/sh -c "python3 manage.py collectstatic --noinput --verbosity 0 && exec conf/entrypoint.sh"
  wait_healthy evilflowers
  echo "The catalog answers on http://${BIND:-127.0.0.1}:8000"
}

down() {
  for c in evilflowers redis postgres; do
    if docker rm -f "$PREFIX-$c" >/dev/null 2>&1; then echo "removed $PREFIX-$c"; fi
  done
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  status) docker ps --filter "name=^$PREFIX-" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' ;;
  *) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
