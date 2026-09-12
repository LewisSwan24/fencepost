"""Vercel function 入口。逻辑都在 proxy/，这里只做 HTTP 收发。"""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from proxy.app import (COPY, Deps, create_session, create_storyboard, handle, handle_stream,
                       delete_entry, edit_entry, register_video, submit_entry, timeline)
from proxy.db import Database, SqliteContext, SqliteHistory, SqliteScreeningLog
from proxy.model import DashScope, UpstreamError, redact

POST_ROUTES = ("/api/session", "/api/storyboards", "/api/videos", "/api/entries",
               "/api/entries/edit", "/api/entries/delete", "/api/assistant")
GET_ROUTES = ("/api/timeline",)
_DEPS = None


def _deps() -> Deps:
    # 历史与上下文走 SQLite；库文件路径用 FENCEPOST_DB 指定，默认放在仓库根目录。
    # 限流仍是内存实作：operations.md §3 那三条上限在 data-model.md §1 里没有对应的表，
    # 加表得先定下来，所以 serverless 多实例之间限流暂时不共享。
    global _DEPS
    if _DEPS is None:
        # Vercel 上只有 /tmp 可写，而且每个实例一份、冷启动就没。
        # 也就是说 serverless 上的 SQLite 只是能跑起来，不是能用——真要用得换托管数据库。
        default_db = ("/tmp/fencepost.db" if os.getenv("VERCEL")
                      else str(Path(__file__).resolve().parent.parent / "fencepost.db"))
        db = Database(os.getenv("FENCEPOST_DB", default_db))
        _DEPS = Deps(client=DashScope(), history=SqliteHistory(db), context=SqliteContext(db),
                     screening=SqliteScreeningLog(db), db=db)
    return _DEPS


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        # 新版 Vercel Python builder 只认 pyproject.toml 里那一个入口，所有路径都进这里，
        # 所以路由得自己分。
        path = self.path.split("?")[0].rstrip("/") or "/"
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return self._json(400, {"error": {"code": "bad_request", "message": COPY["bad_request"]}})
        if path not in POST_ROUTES:
            # 先判路径再建依赖：不认识的地址不该因为缺配置而回 503
            return self._json(404, {"error": {"code": "not_found", "message": COPY["not_found"]}})
        token = (self.headers.get("authorization") or "").removeprefix("Bearer ").strip()
        try:
            deps = _deps()
        except Exception as exc:
            # 配置缺失（例如没配 DASHSCOPE_API_KEY）不该让整个函数崩掉。这条是真部署打出来的：
            # 崩了之后 Vercel 只会回一句 FUNCTION_INVOCATION_FAILED，客户端什么也看不出来。
            print(f"[proxy] deps: {redact(str(exc))[:200]}", file=sys.stderr)
            return self._json(503, {"error": {"code": "upstream_unavailable",
                                              "message": COPY["upstream_unavailable"]}})
        if path == "/api/session":
            return self._json(*create_session(body, deps))
        if path == "/api/storyboards":
            return self._json(*create_storyboard(body, token, deps))
        if path == "/api/videos":
            return self._json(*register_video(body, token, deps))
        if path == "/api/entries":
            return self._json(*submit_entry(body, token, deps))
        if path == "/api/entries/edit":
            return self._json(*edit_entry(body, token, deps))
        if path == "/api/entries/delete":
            return self._json(*delete_entry(body, token, deps))
        if body.get("stream"):
            return self._sse(body, token, deps)
        self._json(*handle(body, token, deps))

    def do_GET(self):
        path, _, query = self.path.partition("?")
        path = path.rstrip("/") or "/"
        if path not in GET_ROUTES:
            return self._json(404, {"error": {"code": "not_found", "message": COPY["not_found"]}})
        token = (self.headers.get("authorization") or "").removeprefix("Bearer ").strip()
        try:
            deps = _deps()
        except Exception as exc:
            print(f"[proxy] deps: {redact(str(exc))[:200]}", file=sys.stderr)
            return self._json(503, {"error": {"code": "upstream_unavailable",
                                              "message": COPY["upstream_unavailable"]}})
        params = {key: values[0] for key, values in parse_qs(query).items()}
        self._json(*timeline(params, token, deps))

    def _sse(self, body: dict, token: str, deps) -> None:
        status, result = handle_stream(body, token, deps)
        if status != 200:
            return self._json(status, result)
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.send_header("cache-control", "no-cache")
        self.send_header("x-accel-buffering", "no")     # 别让中间层把流缓冲成一坨
        self.end_headers()
        self._event({"prompt_version": result.prompt_version})
        try:
            for piece in result:
                self._event({"delta": piece})
        except UpstreamError:
            # 半路断了就发一个错误事件，且不落库——半截回复也是伪造回复。
            self._event({"error": {"code": "upstream_unavailable",
                                   "message": COPY["upstream_unavailable"]}})
            return
        result.finish()
        self._event({"done": True})

    def _event(self, payload: dict) -> None:
        """SSE 的一帧：data: 开头，空行结尾。"""
        self.wfile.write(("data: " + json.dumps(payload) + "\n\n").encode())
        self.wfile.flush()

    def _json(self, status: int, payload: dict) -> None:
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        """默认日志会把请求行写进 stdout，这里静默，免得日志成为另一个泄漏面。"""
