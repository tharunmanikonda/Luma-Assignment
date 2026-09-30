#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/luma}"
RELEASE_DIR="${RELEASE_DIR:?set RELEASE_DIR}"
APP_IMAGE="${APP_IMAGE:?set APP_IMAGE}"
COMPOSE=(docker compose --env-file .env.production.local -f docker-compose.yml)

cd "$APP_DIR"

if [[ ! -f .env.production.local ]]; then
  echo "Missing $APP_DIR/.env.production.local. Run deploy/bootstrap.sh first." >&2
  exit 1
fi

install -m 0644 "$RELEASE_DIR/docker-compose.yml" "$APP_DIR/docker-compose.yml"
install -m 0644 "$RELEASE_DIR/Caddyfile" "$APP_DIR/Caddyfile"

previous_image=""
if [[ -f .deployed-image ]]; then
  previous_image="$(<.deployed-image)"
fi

rollback() {
  trap - ERR
  echo "Deployment failed; restoring the previous application image." >&2
  if [[ -n "$previous_image" ]]; then
    export APP_IMAGE="$previous_image"
    "${COMPOSE[@]}" up -d --remove-orphans
  else
    "${COMPOSE[@]}" down
  fi
}
trap rollback ERR

export APP_IMAGE
"${COMPOSE[@]}" pull
"${COMPOSE[@]}" up -d postgres
"${COMPOSE[@]}" run --rm web npm run db:migrate

if [[ ! -f .demo-seeded ]]; then
  "${COMPOSE[@]}" run --rm web npm run seed:demo
  touch .demo-seeded
fi

"${COMPOSE[@]}" up -d --remove-orphans

for attempt in {1..30}; do
  if curl --fail --silent --show-error http://127.0.0.1/api/ready >/dev/null; then
    printf '%s\n' "$APP_IMAGE" > .deployed-image
    trap - ERR
    docker image prune -f >/dev/null
    echo "Deployment is healthy: $APP_IMAGE"
    exit 0
  fi
  sleep 4
done

echo "Readiness check did not pass within 120 seconds." >&2
exit 1
