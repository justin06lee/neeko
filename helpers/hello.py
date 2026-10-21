#!/usr/bin/env python3
"""The demo app's helper (browser.json's "helpers"): a tiny local server, to
show what an app's helper is. Neeko starts it the first time the demo UI asks
it something, and never before.

It keeps to a helper's contract (docs/api.md, "Helpers"):

- it listens on 127.0.0.1, on any free port, and says which on its first
  line of stdout, as JSON: {"port": 12345};
- it answers only requests with this start's token
  (Authorization: Bearer <NEEKO_HELPER_TOKEN>);
- it exits when its stdin closes: the browser has quit, or crashed.

GET /hello streams a greeting, a word at a time, as server-sent events, then
what Neeko told it about who asked, and how long the secret it was sent is
(never the secret).
"""

import hmac
import http.server
import json
import os
import sys
import threading
import time

TOKEN = os.environ["NEEKO_HELPER_TOKEN"]


class Hello(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        if not hmac.compare_digest(self.headers.get("Authorization", ""), f"Bearer {TOKEN}"):
            self.send_error(401)
            return
        if self.path != "/hello":
            self.send_error(404)
            return
        caller = {
            "caller": self.headers.get("X-Neeko-Caller", ""),
            "container": self.headers.get("X-Neeko-Container", ""),
            "private": self.headers.get("X-Neeko-Private", "") == "1",
            # How long its secret is, if Neeko sent one; never the secret.
            "secret": len(self.headers.get("X-Neeko-Secret-demo-key", "")),
        }
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        try:
            for word in "Hello from the demo app's helper, a program on this computer.".split():
                self.event("word", word)
                time.sleep(0.12)
            self.event("caller", caller)
            self.wfile.write(b"0\r\n\r\n")
        except (BrokenPipeError, ConnectionResetError):
            # The caller cancelled: stop working on it.
            pass

    def event(self, name, data):
        text = f"event: {name}\ndata: {json.dumps(data)}\n\n".encode()
        self.wfile.write(b"%x\r\n%s\r\n" % (len(text), text))
        self.wfile.flush()

    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hello)
server.daemon_threads = True
threading.Thread(target=server.serve_forever, daemon=True).start()
print(json.dumps({"port": server.server_port}), flush=True)
# Until the browser goes.
sys.stdin.read()
