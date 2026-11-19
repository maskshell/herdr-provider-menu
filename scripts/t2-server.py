#!/usr/bin/env python3
# Tiny request recorder: logs method, path, auth headers and body prefix for
# every hit, answers 401 so claude gives up fast. Usage: t2-server.py PORT LOG
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

port, log = int(sys.argv[1]), sys.argv[2]

class H(BaseHTTPRequestHandler):
    def _record(self):
        n = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(n)[:600].decode("utf-8", "replace") if n else ""
        with open(log, "a") as f:
            f.write(f"{self.command} {self.path}\n")
            for k in ("authorization", "x-api-key", "anthropic-version"):
                if self.headers.get(k):
                    f.write(f"  {k}: {self.headers[k]}\n")
            if body:
                f.write(f"  body: {body}\n")
        self.send_response(401)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"type":"error","error":{"type":"authentication_error","message":"probe"}}')
    do_GET = do_POST = _record
    def log_message(self, *a): pass

HTTPServer(("127.0.0.1", port), H).serve_forever()
