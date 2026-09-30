#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/luma}"
SITE_ADDRESS="${SITE_ADDRESS:-http://192.241.148.87}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl docker.io docker-compose-v2 ufw
systemctl enable --now docker

install -d -m 0755 "$APP_DIR/releases"

if [[ ! -f "$APP_DIR/.env.production.local" ]]; then
  postgres_password="$(openssl rand -hex 24)"
  auth_secret="$(openssl rand -hex 32)"

  cat > "$APP_DIR/.env.production.local" <<EOF
NODE_ENV=production
SITE_ADDRESS=$SITE_ADDRESS
APP_ORIGIN=$SITE_ADDRESS
BETTER_AUTH_URL=$SITE_ADDRESS
BETTER_AUTH_SECRET=$auth_secret
POSTGRES_PASSWORD=$postgres_password
LOCAL_OBJECT_STORE_ROOT=/var/lib/luma-object-store
WORKER_ID=worker-production-1
LOG_LEVEL=info

DEMO_WORKSPACE_NAME=Maya Home Goods
DEMO_MAYA_EMAIL=maya@example.test
DEMO_MAYA_PASSWORD=local-maya-password
DEMO_ELLIE_EMAIL=ellie@example.test
DEMO_ELLIE_PASSWORD=local-ellie-password

# Keep the review deployment cost-free until a controlled real-provider test.
LUMA_PROVIDER=fake
LUMA_API_KEY=
DEMO_GENERATION_BUDGET_CENTS=2500
EOF
  chmod 0600 "$APP_DIR/.env.production.local"
fi

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "Droplet bootstrap complete. Runtime secrets are stored at $APP_DIR/.env.production.local."
