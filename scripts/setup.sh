#!/bin/sh
# Prepares this directory to run, from .env:
#
#   - creates .env from .env.example if there is none
#   - replaces every change-me secret with a fresh one (keeps the ones you have)
#   - writes nginx/catalog.conf, nginx/portal.conf and readium/config.yaml from their templates
#   - writes readium/htpasswd for the license servers
#
# Run it again after editing .env. Needs openssl, awk and Docker (the access-token key is made
# with the catalog image itself).
set -eu

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "created .env from .env.example: set your addresses and COMPOSE_PROFILES in it"
fi
chmod 600 .env

# KEY's value in .env. The file is read line by line, never sourced: the JWK holds braces.
get() { awk -v k="$1" 'index($0, k "=") == 1 { v = substr($0, length(k) + 2) } END { print v }' .env; }

# Sets KEY to VALUE in .env, in place of its line (values pass through the environment, so any
# character is safe).
set_value() {
  K="$1" V="$2" awk 'BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"] }
    index($0, k "=") == 1 { print k "=" v; found = 1; next } { print }
    END { if (!found) print k "=" v }' .env > .env.tmp
  mv .env.tmp .env
  chmod 600 .env
}

is_unset() { v=$(get "$1"); [ -z "$v" ] || [ "$v" = change-me ]; }

for key in SECRET_KEY PGPASSWORD ELVIRA_READIUM_PASSWORD EVILFLOWERS_EMBEDDING_API_KEY; do
  if is_unset "$key"; then
    set_value "$key" "$(openssl rand -hex 24)"
    echo "made $key"
  fi
done

if is_unset SECURED_VIEW_JWK; then
  jwk=$(docker run --rm --entrypoint python3 "$(get ELVIRA_CATALOG_IMAGE)" -c \
    'import json; from joserfc.jwk import RSAKey; print(json.dumps(RSAKey.generate_key(2048, private=True).as_dict(private=True), separators=(",", ":")))')
  set_value SECURED_VIEW_JWK "$jwk"
  echo "made SECURED_VIEW_JWK"
fi

# The license servers' credentials, in the two URLs the catalog uses.
user=$(get ELVIRA_READIUM_USER)
password=$(get ELVIRA_READIUM_PASSWORD)
set_value EVILFLOWERS_READIUM_LCPSV_URL "http://$user:$password@readium:8989"
set_value EVILFLOWERS_READIUM_LSDSV_URL "http://$user:$password@readium:8990"

# Fills ${NAME} in a template with .env's values; a name .env does not have is an error.
render() {
  awk 'NR == FNR { i = index($0, "="); if ($0 ~ /^[A-Z][A-Z0-9_]*=/) env[substr($0, 1, i - 1)] = substr($0, i + 1); next }
    {
      line = $0; out = ""
      while (match(line, /\$\{[A-Z][A-Z0-9_]*\}/)) {
        name = substr(line, RSTART + 2, RLENGTH - 3)
        if (!(name in env)) { print FILENAME ": no " name " in .env" > "/dev/stderr"; exit 1 }
        out = out substr(line, 1, RSTART - 1) env[name]
        line = substr(line, RSTART + RLENGTH)
      }
      print out line
    }' .env "$1" > "$2.tmp"
  mv "$2.tmp" "$2"
  echo "wrote $2"
}

render nginx/catalog.conf.tmpl nginx/catalog.conf
if [ -n "$(get ELVIRA_PORTAL_DOMAIN)" ]; then
  render nginx/portal.conf.tmpl nginx/portal.conf
else
  rm -f nginx/portal.conf
fi
render readium/config.yaml.tmpl readium/config.yaml
chmod 600 readium/config.yaml

# {SHA} scheme: base64 of the password's SHA-1, which the Readium servers read.
printf '%s:{SHA}%s\n' "$user" "$(printf '%s' "$password" | openssl dgst -sha1 -binary | openssl base64)" > readium/htpasswd
chmod 600 readium/htpasswd
echo "wrote readium/htpasswd"
