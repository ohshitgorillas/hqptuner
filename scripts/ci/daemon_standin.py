#!/usr/bin/env python3
"""Answer hqplayerd's 8088 credential wire for a CI job that has no daemon.

  python3 scripts/ci/daemon_standin.py HOST PORT

A request with no ``Authorization`` header is answered 401 with a Digest challenge, and a request that carries one is
answered 200 with an empty body, on every path. That is all HQPTuner's login check reads: the status of one
Digest-authenticated page. This is a table, not an implementation of Digest, and it never verifies a digest, so it
proves that a caller logs in and not that a pair is right.

Standard library only: the packaging jobs that run it have no virtual environment.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

#: The challenge hqplayerd sends, in the shape ``tests/support/fake_http.py`` uses.
CHALLENGE = (
    'Digest realm="com.signalyst.hqplayer.embedded", qop="auth", algorithm=MD5, '
    'nonce="1f3a9c2b4d5e6f70", opaque="0a1b2c3d4e5f6071", charset=UTF-8'
)


class Handler(BaseHTTPRequestHandler):
    """Answer 401 with the challenge until the request carries an ``Authorization`` header, then 200."""

    def do_GET(self) -> None:
        """Answer one GET."""
        if self.headers.get("Authorization"):
            self.send_response(200)
            self.send_header("Content-Length", "0")
        else:
            self.send_response(401)
            self.send_header("WWW-Authenticate", CHALLENGE)
            self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, fmt: str, *args: object) -> None:
        """Stay quiet: a CI log has no use for one line per poll."""


def main(argv: list[str]) -> int:
    """Serve on ``HOST PORT`` until killed, printing the bound address once it listens."""
    parser = argparse.ArgumentParser(description="Answer hqplayerd's 8088 credential wire.")
    parser.add_argument("host")
    parser.add_argument("port", type=int)
    args = parser.parse_args(argv[1:])
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"daemon stand-in listening on {args.host}:{server.server_port}", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
