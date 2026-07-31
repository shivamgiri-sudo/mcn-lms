#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOMAIN="${MCNMEET_DOMAIN:-mcnmeet.teammas.in}"
EMAIL="${LETSENCRYPT_EMAIL:-it@teammas.in}"
INSTALL_DIR="${MCNMEET_DIR:-/opt/mcnmeet}"
RELEASE_URL="${JITSI_RELEASE_URL:-https://github.com/jitsi/docker-jitsi-meet/archive/refs/tags/stable-11031.tar.gz}"

set_env() {
  local key="$1"
  local value="$2"

  if grep -qE "^#?${key}=" .env; then
    sed -i "/^#\\?${key}=/c\\${key}=${value}" .env
  else
    printf '\n%s=%s\n' "$key" "$value" >> .env
  fi
}

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Engine and rerun this script." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is required. Install docker compose and rerun this script." >&2
  exit 1
fi

sudo mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

if [ ! -f docker-jitsi-meet.yml ]; then
  tmp="$(mktemp -d)"
  curl -fsSL "$RELEASE_URL" -o "$tmp/jitsi.tar.gz"
  tar -xzf "$tmp/jitsi.tar.gz" -C "$tmp"
  release_dir="$(find "$tmp" -maxdepth 1 -type d -name 'docker-jitsi-meet-*' | head -n 1)"

  compose_src="$release_dir/compose.yaml"
  if [ ! -f "$compose_src" ]; then
    compose_src="$release_dir/docker-compose.yml"
  fi

  cp "$compose_src" docker-jitsi-meet.yml
  cp "$release_dir/env.example" upstream.env.example
  if [ -f "$release_dir/gen-passwords.sh" ]; then
    cp "$release_dir/gen-passwords.sh" gen-passwords.sh
    chmod +x gen-passwords.sh
  fi
  rm -rf "$tmp"
fi

if [ ! -f .env ]; then
  cp upstream.env.example .env
  cat "$SCRIPT_DIR/.env.example" >> .env
  set_env PUBLIC_URL "https://$DOMAIN"
  set_env ENABLE_LETSENCRYPT "1"
  set_env LETSENCRYPT_DOMAIN "$DOMAIN"
  set_env LETSENCRYPT_EMAIL "$EMAIL"
  set_env JITSI_WATERMARK_LINK "https://$DOMAIN"
  set_env JWT_APP_ID "mcn-lms"
  set_env JWT_APP_SECRET "$(openssl rand -hex 32)"

  if [ -x ./gen-passwords.sh ]; then
    ./gen-passwords.sh
  fi
fi

mkdir -p jitsi-config/{web,transcripts,prosody/config,prosody/prosody-plugins-custom,jicofo,jvb,jigasi,jibri}

docker compose -f docker-jitsi-meet.yml --env-file .env pull
docker compose -f docker-jitsi-meet.yml --env-file .env up -d

echo "MCNmeet deployment started: https://$DOMAIN"
