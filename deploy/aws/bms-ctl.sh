#!/usr/bin/env bash
# ADR 0096 — bms-ctl: the only way the BMS demo stack on the AWS host changes.
#
# Installed by setup-server.sh as /usr/local/sbin/bms-ctl (root:root 0755).
# It is NOT run from the repository checkout, so a merged commit cannot change
# what root executes here; after editing this file, re-run setup-server.sh.
#
# Callers:
#   - The deploy workflow, as user `bmsdeploy`, through the forced command
#     /usr/local/sbin/bms-ctl-ssh and one sudoers rule. sudo resets the
#     environment, so BMS_ALLOW_UNMERGED below cannot come from that path.
#   - An administrator with sudo on the host.
#
# Commands:
#   deploy <40-hex-sha>   Check out <sha> (must be on origin/main), pull the
#                         images tagged <sha>, and bring the stack up. A GHCR
#                         token may be given on stdin for private packages.
#   rollback              Re-deploy the previous SHA from local images.
#   sim start|stop|status Telemetry simulator. The choice survives deploys.
#   status                Deployed SHA, containers, health.
#   logs <service>        Last 200 log lines of one service.

set -euo pipefail

BMS_HOME=/var/www/bms
REPO="$BMS_HOME/repo"
RUNTIME="$BMS_HOME/runtime"
STATE="$BMS_HOME/state"
ENV_FILE="$BMS_HOME/.env"
COMPOSE_FILE="$REPO/deploy/aws/docker-compose.yml"
HEALTH_URL="http://127.0.0.1:5175/health"
SERVICES="postgres redis minio keycloak keycloak-provision migrate api worker web sim"

die() { echo "bms-ctl: $*" >&2; exit 1; }
log() { echo "bms-ctl: $*"; }

[ "$(id -u)" -eq 0 ] || die "run as root (sudo)"
[ -f "$ENV_FILE" ] || die "$ENV_FILE is missing — run setup-server.sh"
mkdir -p "$STATE"

# One change at a time: a deploy and a sim toggle never interleave.
exec 9>"$STATE/.lock"
flock -w 900 9 || die "another bms-ctl is running"

env_value() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }
IMAGE_OWNER="$(env_value IMAGE_OWNER)"
[ -n "$IMAGE_OWNER" ] || die "IMAGE_OWNER is not set in $ENV_FILE"

current_sha() { cat "$STATE/current" 2>/dev/null || true; }

compose() {
  local tag="$1"; shift
  local profiles=()
  [ -f "$STATE/sim-enabled" ] && profiles=(--profile sim)
  IMAGE_TAG="$tag" docker compose \
    --project-name bms \
    --project-directory "$BMS_HOME" \
    --env-file "$ENV_FILE" \
    -f "$COMPOSE_FILE" \
    "${profiles[@]}" "$@"
}

images_for() {
  local tag="$1"
  printf 'ghcr.io/%s/ems-%s:%s\n' "$IMAGE_OWNER" api "$tag" "$IMAGE_OWNER" web "$tag" "$IMAGE_OWNER" sim "$tag"
}

have_images() {
  local img
  for img in $(images_for "$1"); do
    docker image inspect "$img" >/dev/null 2>&1 || return 1
  done
}

render_runtime() {
  local demo_password
  demo_password="$(env_value DEMO_PASSWORD)"
  [ -n "$demo_password" ] || die "DEMO_PASSWORD is not set in $ENV_FILE"
  case "$demo_password" in *[!A-Za-z0-9-]*) die "DEMO_PASSWORD must be [A-Za-z0-9-]" ;; esac

  mkdir -p "$RUNTIME/docker-init" "$RUNTIME/keycloak-import"
  install -m 0644 "$REPO"/packages/db/docker-init/* "$RUNTIME/docker-init/"
  install -m 0644 "$REPO/deploy/aws/nginx.conf" "$RUNTIME/nginx.conf"
  # The realm ships the local demo passwords; the public demo gets its own.
  # Keycloak reads this only when the realm does not exist yet.
  sed -E "s/\"value\": \"(admin|operator|viewer)123\"/\"value\": \"$demo_password\"/" \
    "$REPO/infra/keycloak/bms-realm.json" > "$RUNTIME/keycloak-import/bms-realm.json"
  chown -R 1000:0 "$RUNTIME/keycloak-import"
  chmod 0700 "$RUNTIME/keycloak-import"
  chmod 0600 "$RUNTIME/keycloak-import/bms-realm.json"
}

wait_healthy() {
  local i
  for i in $(seq 1 60); do
    if curl -fsS -o /dev/null "$HEALTH_URL"; then
      log "healthy ($HEALTH_URL)"
      return 0
    fi
    sleep 5
  done
  compose "$1" ps -a || true
  compose "$1" logs --tail 80 api migrate keycloak-provision || true
  die "not healthy after 300 s"
}

prune_images() {
  local keep_current keep_previous img
  keep_current="$(current_sha)"
  keep_previous="$(cat "$STATE/previous" 2>/dev/null || true)"
  docker image ls --format '{{.Repository}}:{{.Tag}}' \
    | grep -E "^ghcr\.io/$IMAGE_OWNER/ems-(api|web|sim):[0-9a-f]{40}$" \
    | while read -r img; do
        case "$img" in
          *":$keep_current" | *":$keep_previous") ;;
          *) docker image rm "$img" >/dev/null 2>&1 || true ;;
        esac
      done
}

do_deploy() {
  local sha="$1" token=""
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "deploy needs a full 40-character commit SHA"

  # Optional GHCR token on stdin (the workflow's short-lived GITHUB_TOKEN).
  if [ ! -t 0 ]; then IFS= read -r token || true; fi

  log "fetching origin/main"
  git -C "$REPO" fetch --quiet origin main
  git -C "$REPO" cat-file -e "$sha^{commit}" 2>/dev/null \
    || git -C "$REPO" fetch --quiet origin "$sha" \
    || die "commit $sha not found"
  if ! git -C "$REPO" merge-base --is-ancestor "$sha" origin/main; then
    [ "${BMS_ALLOW_UNMERGED:-}" = "1" ] || die "$sha is not on origin/main"
    log "WARNING: $sha is not on origin/main (BMS_ALLOW_UNMERGED=1)"
  fi
  git -C "$REPO" checkout --quiet --detach "$sha"
  render_runtime

  if [ -n "$token" ]; then
    # A throw-away client config: the token never lands in root's
    # ~/.docker/config.json, and it expires with the workflow job anyway.
    local cfg rc=0
    cfg="$(mktemp -d)"
    printf '%s' "$token" | DOCKER_CONFIG="$cfg" docker login ghcr.io -u "$IMAGE_OWNER" --password-stdin >/dev/null || rc=$?
    if [ "$rc" -eq 0 ]; then
      log "pulling images for $sha"
      DOCKER_CONFIG="$cfg" compose "$sha" --profile sim pull --quiet || rc=$?
    fi
    rm -rf "$cfg"
    [ "$rc" -eq 0 ] || die "GHCR login or pull failed for $sha"
  elif ! have_images "$sha"; then
    log "pulling images for $sha (anonymous)"
    compose "$sha" --profile sim pull --quiet
  fi

  log "starting the stack at $sha"
  compose "$sha" up -d --remove-orphans

  local previous
  previous="$(current_sha)"
  if [ -n "$previous" ] && [ "$previous" != "$sha" ]; then
    echo "$previous" > "$STATE/previous"
  fi
  echo "$sha" > "$STATE/current"

  wait_healthy "$sha"
  prune_images
  log "deployed $sha"
}

do_rollback() {
  local previous
  previous="$(cat "$STATE/previous" 2>/dev/null || true)"
  [ -n "$previous" ] || die "no previous deployment recorded"
  have_images "$previous" || die "images for $previous are no longer on this host"
  BMS_ALLOW_UNMERGED=1 do_deploy "$previous" </dev/null
}

do_sim() {
  local sha
  sha="$(current_sha)"
  [ -n "$sha" ] || die "nothing is deployed yet"
  case "${1:-}" in
    start)
      touch "$STATE/sim-enabled"
      compose "$sha" up -d sim
      log "simulator started"
      ;;
    stop)
      rm -f "$STATE/sim-enabled"
      compose "$sha" --profile sim stop sim
      compose "$sha" --profile sim rm -f sim
      log "simulator stopped"
      ;;
    status)
      if [ -f "$STATE/sim-enabled" ]; then log "simulator: enabled"; else log "simulator: disabled"; fi
      compose "$sha" --profile sim ps sim
      ;;
    *) die "usage: bms-ctl sim start|stop|status" ;;
  esac
}

do_status() {
  local sha
  sha="$(current_sha)"
  log "current:  ${sha:-none}"
  log "previous: $(cat "$STATE/previous" 2>/dev/null || echo none)"
  [ -n "$sha" ] || return 0
  compose "$sha" ps -a
  if curl -fsS -o /dev/null "$HEALTH_URL"; then log "health: ok"; else log "health: FAILING"; fi
}

do_logs() {
  local sha service="${1:-}"
  sha="$(current_sha)"
  [ -n "$sha" ] || die "nothing is deployed yet"
  [[ "$service" =~ ^[a-z-]+$ && " $SERVICES " == *" $service "* ]]     || die "unknown service '$service' (one of: $SERVICES)"
  compose "$sha" --profile sim logs --no-color --tail 200 "$service"
}

case "${1:-status}" in
  deploy)   [ $# -eq 2 ] || die "usage: bms-ctl deploy <sha>"; do_deploy "$2" ;;
  rollback) [ $# -eq 1 ] || die "usage: bms-ctl rollback"; do_rollback ;;
  sim)      [ $# -eq 2 ] || die "usage: bms-ctl sim start|stop|status"; do_sim "$2" ;;
  status)   [ $# -le 1 ] || die "usage: bms-ctl status"; do_status ;;
  logs)     [ $# -eq 2 ] || die "usage: bms-ctl logs <service>"; do_logs "$2" ;;
  *)        die "unknown command '$1' (deploy, rollback, sim, status, logs)" ;;
esac
