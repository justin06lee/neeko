"""mitmproxy add-on for tools/test_privacy.py: records every connection.

Writes one JSON line per event to the file in $NEEKO_PRIVACY_LOG:
{"t": <unix time>, "kind": "connect" | "request" | "tls-failed", "host", "url"}.
"""

import json
import os
import time

LOG = open(os.environ["NEEKO_PRIVACY_LOG"], "a", buffering=1)


def record(kind, host, url=""):
    LOG.write(json.dumps({"t": time.time(), "kind": kind, "host": host, "url": url}) + "\n")


def http_connect(flow):
    record("connect", flow.request.host)


def requestheaders(flow):
    if flow.request.method != "CONNECT":
        record("request", flow.request.pretty_host, flow.request.pretty_url)


def tls_failed_client(data):
    # The browser refused the proxy's certificate (for example a pinned host).
    # The connection is still counted by its name.
    host = data.context.client.sni or ""
    record("tls-failed", host)
