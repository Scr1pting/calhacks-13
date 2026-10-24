"""Tiny live feed (stdlib only) that replays a simulated day in "real time".

  GET /                      map viewer
  GET /meta                  replay_meta.json
  GET /stream                Server-Sent Events, one message per sim minute:
                             {"t": <minutes>, "clock": "9:42", "events": [...]}
  GET /trip?id=<trip_id>     every stop event for one trip so far (for a voice agent)

--speed is sim seconds per real second (60 = one sim minute per second).
"""
from __future__ import annotations

import json
import os
import threading
import time
from collections import defaultdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(__file__)


def serve(data_dir: str, port: int, speed: float, start: float):
    with open(os.path.join(data_dir, "replay_meta.json")) as f:
        meta = json.load(f)
    by_min = defaultdict(list)
    with open(os.path.join(data_dir, "replay.jsonl")) as f:
        for line in f:
            e = json.loads(line)
            by_min[int(e["t"])].append(e)
    t_first, t_last = max(int(start), int(meta["start"])), int(meta["end"]) + 1
    state = {"t": t_first}

    def clock_loop():  # one shared clock so every client sees the same moment
        while True:
            time.sleep(60.0 / speed)
            state["t"] = state["t"] + 1 if state["t"] < t_last else t_first

    threading.Thread(target=clock_loop, daemon=True).start()

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _json(self, obj):
            body = json.dumps(obj).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            u = urlparse(self.path)
            if u.path == "/":
                with open(os.path.join(HERE, "viewer.html"), "rb") as f:
                    body = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(body)
            elif u.path == "/meta":
                self._json(dict(meta, now=state["t"]))
            elif u.path == "/trip":
                tid = parse_qs(u.query).get("id", [""])[0]
                now = state["t"]
                self._json([e for m in range(t_first - 600, now + 1) for e in by_min.get(m, [])
                            if e.get("trip_id") == tid])
            elif u.path == "/stream":
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                last = state["t"] - 1
                try:
                    while True:
                        now = state["t"]
                        if now != last:
                            h, mi = divmod(now, 60)
                            msg = json.dumps(dict(t=now, clock=f"{h}:{mi:02d}", events=by_min.get(now, [])))
                            self.wfile.write(f"data: {msg}\n\n".encode())
                            self.wfile.flush()
                            last = now
                        time.sleep(0.05)
                except (BrokenPipeError, ConnectionResetError):
                    return
            else:
                self.send_error(404)

    print(f"Serving day {meta['day']} ({meta['weekday']}) at http://localhost:{port}  speed={speed}x")
    ThreadingHTTPServer(("0.0.0.0", port), H).serve_forever()
