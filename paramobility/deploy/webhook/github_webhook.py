"""GitHub webhook listener that redeploys after CI passes on main.

Runs on the server as a systemd service (paramobility-webhook.service) and is
reachable through Caddy at https://$HOOKS_DOMAIN/github. Subscribe the GitHub
webhook to "Workflow runs" only. A delivery triggers a deploy when it is a
completed, successful run of $DEPLOY_WORKFLOW for a push to $DEPLOY_BRANCH; the
deploy runs in its own systemd unit so restarting this service can't cut it off.

Standard library only, so it runs on the host's python3 with nothing installed.
"""

import hashlib
import hmac
import json
import logging
import os
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SECRET = os.environ["GITHUB_WEBHOOK_SECRET"].encode()
BRANCH = os.environ.get("DEPLOY_BRANCH", "main")
WORKFLOW = os.environ.get("DEPLOY_WORKFLOW", "CI")
DEPLOY_SCRIPT = os.environ["DEPLOY_SCRIPT"]
PORT = int(os.environ.get("WEBHOOK_PORT", "9000"))

log = logging.getLogger("github-webhook")


def signature_ok(body: bytes, header: str) -> bool:
    expected = "sha256=" + hmac.new(SECRET, body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header)


def deploy_sha(event: str, payload: dict) -> str | None:
    """The commit to deploy, or None if this delivery shouldn't deploy anything."""
    if event != "workflow_run" or payload.get("action") != "completed":
        return None
    run = payload["workflow_run"]
    if (
        run.get("name") == WORKFLOW
        and run.get("conclusion") == "success"
        and run.get("event") == "push"
        and run.get("head_branch") == BRANCH
    ):
        return run["head_sha"]
    return None


def start_deploy(sha: str) -> None:
    unit = f"paramobility-deploy-{int(time.time())}"
    subprocess.run(
        ["systemd-run", f"--unit={unit}", "--collect", "/bin/bash", DEPLOY_SCRIPT, sha], check=True
    )
    log.info("started %s for %s", unit, sha)


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/github":
            return self._reply(404, "not found")
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        event = self.headers.get("X-GitHub-Event", "")
        signature = self.headers.get("X-Hub-Signature-256", "")
        if not signature_ok(body, signature):
            # GitHub shows this reply under the webhook's Recent Deliveries.
            reason = (
                "signature mismatch: the webhook's secret on GitHub differs from "
                "GITHUB_WEBHOOK_SECRET on the server"
                if signature
                else "no signature: set a secret on the GitHub webhook"
            )
            log.warning("rejected %s delivery %s: %s", event or "unknown",
                        self.headers.get("X-GitHub-Delivery", "?"), reason)
            return self._reply(401, reason)
        if event == "ping":
            return self._reply(200, "pong")
        sha = deploy_sha(event, json.loads(body))
        if sha is None:
            return self._reply(202, "ignored")
        try:
            start_deploy(sha)
        except subprocess.CalledProcessError:
            log.exception("could not start deploy")
            return self._reply(500, "could not start deploy")
        return self._reply(202, f"deploying {sha[:7]}")

    def _reply(self, status: int, text: str) -> None:
        data = text.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        log.info("%s %s", self.address_string(), fmt % args)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    log.info("listening on :%d for %s runs on %s", PORT, WORKFLOW, BRANCH)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
