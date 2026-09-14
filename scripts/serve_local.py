#!/usr/bin/env python3
"""Run the handler from api/index.py on this machine.

    python scripts/serve_local.py --port 8787

Vercel's Python function uses the same handler class; this only starts an HTTPServer around
it. Running here does not mean it runs on Vercel — that adds packaging and dependency
installation on top.
"""

import argparse
import sys
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api.index import handler


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    print(f"POST http://127.0.0.1:{args.port}/api/assistant   Ctrl+C to stop")
    server.serve_forever()


if __name__ == "__main__":
    main()
