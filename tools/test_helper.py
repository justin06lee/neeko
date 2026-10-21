#!/usr/bin/env python3
"""The API test's helper (tools/test_api.py installs it as "echo", in a
folder of helpers the test points neeko.helpers.path at). It keeps to a
helper's contract (docs/api.md, "Helpers"), and tells the checks what it got:

  /echo          the request (method, path, headers, body) and its own
                 surroundings (environment names, folder, process, port)
  /stream?n=3    n chunks, a moment apart
  /forever       chunks until the caller cancels; /cancelled says if it did
  /status/204    an answer with no body
  /exit          answers, then exits, as a crash would
"""

import hashlib
import hmac
import http.server
import json
import os
import sys
import threading
import time
import urllib.parse

TOKEN = os.environ.get("NEEKO_HELPER_TOKEN", "")
cancelled = threading.Event()


class Echo(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def answer(self, status, body=b"", kind="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("X-Helper", "echo")
        if status not in (204, 304):
            self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if status not in (204, 304):
            self.wfile.write(body)

    def chunk(self, data):
        self.wfile.write(b"%x\r\n%s\r\n" % (len(data), data))
        self.wfile.flush()

    def handle_any(self):
        if not TOKEN or not hmac.compare_digest(self.headers.get("Authorization", ""), f"Bearer {TOKEN}"):
            self.answer(401, b'{"error": "no token"}')
            return
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        url = urllib.parse.urlsplit(self.path)
        if url.path == "/echo":
            reply = {
                "method": self.command,
                "path": self.path,
                "headers": {
                    k.lower(): v for k, v in self.headers.items() if k.lower() != "authorization"
                },
                "body": body.decode("utf-8", "replace"),
                "bodyHex": body.hex(),
                "tokenHash": hashlib.sha256(TOKEN.encode()).hexdigest()[:12],
                "env": sorted(os.environ),
                "envPath": os.environ.get("PATH", ""),
                "dataDir": os.environ.get("NEEKO_HELPER_DATA"),
                "cwd": os.getcwd(),
                "mode": oct(os.stat(os.getcwd()).st_mode & 0o777),
                "pid": os.getpid(),
                "port": self.server.server_port,
            }
            self.answer(200, json.dumps(reply).encode())
        elif url.path == "/stream":
            n = int(urllib.parse.parse_qs(url.query).get("n", ["3"])[0])
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("X-Helper", "echo")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            for i in range(n):
                self.chunk(f"chunk {i}\n".encode())
                time.sleep(0.2)
            self.wfile.write(b"0\r\n\r\n")
        elif url.path == "/forever":
            cancelled.clear()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            try:
                for i in range(600):
                    self.chunk(f"tick {i}\n".encode())
                    time.sleep(0.1)
            except (BrokenPipeError, ConnectionResetError):
                cancelled.set()
        elif url.path == "/cancelled":
            self.answer(200, json.dumps(cancelled.is_set()).encode())
        elif url.path == "/status/204":
            self.answer(204)
        elif url.path == "/exit":
            self.answer(200, b"{}")
            threading.Timer(0.2, lambda: os._exit(3)).start()
        else:
            self.answer(404, b"{}")

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = do_HEAD = do_OPTIONS = handle_any

    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Echo)
server.daemon_threads = True
threading.Thread(target=server.serve_forever, daemon=True).start()
print(json.dumps({"port": server.server_port}), flush=True)
print("listening", file=sys.stderr, flush=True)
sys.stdin.read()
