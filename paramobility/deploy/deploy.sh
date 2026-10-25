#!/usr/bin/env bash
# Deploy a commit of main on the server: check it out, rebuild, restart.
# Started by the GitHub webhook; can also be run by hand:
#   /opt/paramobility/repo/paramobility/deploy/deploy.sh [sha]
set -euo pipefail

ROOT=/opt/paramobility
REPO=$ROOT/repo
SHA=${1:-origin/main}

if [ "${DEPLOY_STAGE:-1}" = 1 ]; then
    exec 9>"$ROOT/deploy.lock"
    flock 9  # one deploy at a time; a newer one waits for the current one
    exec > >(tee -a "$ROOT/deploy.log") 2>&1

    echo "=== $(date -Is) deploying $SHA"
    cd "$REPO"
    git fetch --quiet origin main
    if ! git merge-base --is-ancestor "$SHA" origin/main; then
        echo "$SHA is not on origin/main, refusing to deploy"
        exit 1
    fi
    git reset --quiet --hard "$SHA"
    echo "checked out $(git log -1 --format='%h %s')"

    # Bash keeps running the copy of this script it started with, so continue
    # with the one just checked out: changes to these steps apply on this deploy.
    # The lock and the log stay open across the exec.
    DEPLOY_STAGE=2 exec bash "$REPO/paramobility/deploy/deploy.sh" "$SHA"
fi

cd "$REPO/paramobility/deploy"
export PARAMOBILITY_ENV_FILE=$ROOT/.env
docker compose build api

# The fleet dashboard is a static site: build it in a throwaway Node container.
# It gets the whole frontend folder: the films import the rider app. The rider
# app itself goes in its /rider/, for phones paired with the presentation (it
# has no key built in; pairing hands the phone one). Both build into .build and
# are copied over dist only when they succeeded, so the site never goes blank
# while it builds (Caddy serves dist; its old files stay for open pages).
docker run --rm -v "$REPO/paramobility/frontend:/frontend" -w /frontend/dashboard node:22-slim \
    sh -c 'npm ci --legacy-peer-deps --no-audit --no-fund \
        && npx vite build --outDir .build --emptyOutDir \
        && cd ../rider && npm ci --no-audit --no-fund \
        && npx vite build --base /rider/ --outDir ../dashboard/.build/rider --emptyOutDir \
        && cd ../dashboard && mkdir -p dist && cp -a .build/. dist/'

docker compose up -d --remove-orphans
docker image prune -f >/dev/null

for _ in $(seq 1 30); do
    if [ "$(docker compose ps api --format '{{.Health}}')" = healthy ]; then
        echo "=== $(date -Is) deployed $(git rev-parse --short HEAD), api healthy"
        # Pick up changes to the webhook listener itself.
        systemctl restart paramobility-webhook
        exit 0
    fi
    sleep 2
done
echo "=== api did not become healthy"
docker compose logs --tail 50 api
exit 1
