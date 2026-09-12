#!/usr/bin/env python3
"""把 api/assistant.py 的 handler 跑在本机。

    python scripts/serve_local.py --port 8787

Vercel 的 Python function 用的就是同一个 handler 类，这里只是自己起了个 HTTPServer。
跑得起来不等于 Vercel 上跑得起来——那边还有打包和依赖安装。
"""

import argparse
import sys
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api.assistant import handler


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    print(f"POST http://127.0.0.1:{args.port}/api/assistant   Ctrl+C 停")
    server.serve_forever()


if __name__ == "__main__":
    main()
