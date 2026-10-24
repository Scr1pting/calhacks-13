#!/usr/bin/env bash
# One-time server setup. Run as root on a fresh Ubuntu machine:
#   ssh root@<server> 'bash -s' < paramobility/deploy/bootstrap.sh
# Then run install-webhook.sh (see docs/DEPLOY.md).
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq docker.io docker-compose-v2 docker-buildx git ufw
systemctl enable --now docker

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

mkdir -p /opt/paramobility
touch /opt/paramobility/.env
chmod 600 /opt/paramobility/.env

docker --version
docker compose version
