"""Drive a running Neeko dev build from the command line, for testing.

Start the browser with Marionette and chrome access, for example:

    engine/obj-*/dist/Nightly.app/Contents/MacOS/firefox -no-remote \
        -marionette -remote-allow-system-access -profile /tmp/neeko-profile

Then, from another terminal:

    python3 tools/marionette.py 'return gBrowser.tabs.length'
    python3 tools/marionette.py --click 120 40

Scripts run in the browser window's chrome context (they can use gBrowser,
document, Services, and await) and print their return value. --click sends a
synthesized mouse click at window coordinates, through normal hit-testing.
"""

import json
import socket
import sys


class Marionette:
    def __init__(self, port=2828):
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=60)
        self.buf = b""
        self.msg_id = 0
        self._read()  # server hello
        self.send("WebDriver:NewSession", {"capabilities": {}})
        self.send("Marionette:SetContext", {"value": "chrome"})

    def _read(self):
        while b":" not in self.buf:
            self.buf += self.sock.recv(65536)
        length, rest = self.buf.split(b":", 1)
        length = int(length)
        while len(rest) < length:
            rest += self.sock.recv(65536)
        self.buf = rest[length:]
        return json.loads(rest[:length])

    def send(self, name, params=None):
        self.msg_id += 1
        data = json.dumps([0, self.msg_id, name, params or {}]).encode()
        self.sock.sendall(str(len(data)).encode() + b":" + data)
        while True:
            msg = self._read()
            if msg[0] == 1 and msg[1] == self.msg_id:
                if msg[2]:
                    raise RuntimeError(msg[2])
                return msg[3]

    def run(self, script):
        """Run an async script body in the chrome context; returns its value."""
        wrapped = (
            "let resolve = arguments[arguments.length - 1];"
            f"(async () => {{ {script} }})()"
            ".then(resolve, e => resolve('ERROR: ' + e + '\\n' + e.stack));"
        )
        result = self.send(
            "WebDriver:ExecuteAsyncScript", {"script": wrapped, "args": []}
        )
        return result.get("value")

    def click(self, x, y):
        self.send(
            "WebDriver:PerformActions",
            {
                "actions": [
                    {
                        "type": "pointer",
                        "id": "mouse",
                        "parameters": {"pointerType": "mouse"},
                        "actions": [
                            {"type": "pointerMove", "x": int(x), "y": int(y)},
                            {"type": "pointerDown", "button": 0},
                            {"type": "pointerUp", "button": 0},
                        ],
                    }
                ]
            },
        )
        self.send("WebDriver:ReleaseActions")


if __name__ == "__main__":
    m = Marionette()
    if sys.argv[1] == "--click":
        m.click(float(sys.argv[2]), float(sys.argv[3]))
    else:
        value = m.run(sys.argv[1])
        print(value if isinstance(value, str) else json.dumps(value, indent=1))
