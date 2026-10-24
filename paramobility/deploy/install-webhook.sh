#!/usr/bin/env bash
# One-time setup of webhook deploys on the server. Run as root after bootstrap.sh:
#   ssh root@<server> 'bash -s' < paramobility/deploy/install-webhook.sh
# Safe to re-run. The first run prints a deploy key to add to the GitHub repo.
set -euo pipefail

ROOT=/opt/paramobility
REPO=$ROOT/repo
REPO_URL=${REPO_URL:-git@github.com:Scr1pting/calhacks-13.git}
KEY=/root/.ssh/github_deploy_key

# Read-only key the server uses to pull the private repo.
if [ ! -f "$KEY" ]; then
    ssh-keygen -q -t ed25519 -N "" -C "paramobility-server" -f "$KEY"
fi
if ! grep -q "Host github.com" /root/.ssh/config 2>/dev/null; then
    printf 'Host github.com\n  IdentityFile %s\n  IdentitiesOnly yes\n' "$KEY" >> /root/.ssh/config
fi
ssh-keygen -F github.com >/dev/null || ssh-keyscan -t ed25519 github.com >> /root/.ssh/known_hosts 2>/dev/null

if [ ! -d "$REPO/.git" ] && ! git clone --quiet --branch main "$REPO_URL" "$REPO"; then
    echo
    echo "Cannot clone $REPO_URL yet. Add this key in GitHub → repo Settings →"
    echo "Deploy keys → Add deploy key (leave write access off), then re-run:"
    echo
    cat "$KEY.pub"
    exit 1
fi

if [ ! -f "$ROOT/webhook.env" ]; then
    umask 077
    cat > "$ROOT/webhook.env" <<EOF
GITHUB_WEBHOOK_SECRET=$(openssl rand -hex 32)
DEPLOY_SCRIPT=$REPO/paramobility/deploy/deploy.sh
DEPLOY_BRANCH=main
DEPLOY_WORKFLOW=CI
EOF
fi

# Caddy reaches the listener from the Docker network; port 9000 stays closed to the internet.
ufw allow from 172.16.0.0/12 to any port 9000 proto tcp >/dev/null

ln -sf "$REPO/paramobility/deploy/webhook/paramobility-webhook.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now paramobility-webhook
systemctl restart paramobility-webhook

echo "Webhook listener running. Its secret is GITHUB_WEBHOOK_SECRET in $ROOT/webhook.env."
