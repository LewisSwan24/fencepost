"""Vercel function entrypoint. The logic lives in proxy/; this only does HTTP."""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from proxy.app import (COPY, Deps, create_session, create_storyboard, handle, handle_stream,
                       cast_review_vote, close_storyboard, create_post, create_thread,
                       dashboard, delete_entry, dispose_entry,
                       edit_entry, issue_share_link, list_grants, list_share_links, list_threads,
                       delete_post, login, read_thread, register,
                       review_queue,
                       redeem_share_link, register_video, revoke_grant, revoke_share_link,
                       submit_entry, timeline)
from proxy.env import load_env
from proxy.db import (Database, SqliteContext, SqliteHistory, SqliteRateLimiter,
                      SqliteScreeningLog)
from proxy.model import DashScope, UpstreamError, redact

POST_ROUTES = ("/api/session", "/api/register", "/api/login",
               "/api/storyboards", "/api/storyboards/close",
               "/api/videos", "/api/entries",
               "/api/entries/edit", "/api/entries/delete", "/api/share-links",
               "/api/share-links/redeem", "/api/share-links/revoke", "/api/grants/revoke",
               "/api/forum/threads", "/api/forum/posts", "/api/forum/posts/delete",
               "/api/review/vote",
               "/api/review/dispose", "/api/assistant")
GET_ROUTES = {"/api/timeline": timeline, "/api/dashboard": dashboard,
              "/api/forum": list_threads, "/api/forum/thread": read_thread,
              "/api/review": review_queue, "/api/grants": list_grants,
              "/api/share-links": list_share_links}
_DEPS = None
# This is the price of running two Vercel projects: the front end calls across origins, so
# it has to be allowed. In production set FENCEPOST_ALLOWED_ORIGIN to the front end's
# domain and leave no wildcard.
#
# Several may be given, comma separated. Not for flexibility: one front end on Vercel
# carries several production aliases at once (the named one, `-git-main-`, `-<team>`), and
# honouring only one of them means opening the site from another alias gives a blank page,
# while the browser says only that CORS failed and never which origin was refused — the
# hardest kind of fault to trace with an audience watching.
ALLOWED_ORIGINS = tuple(
    origin.strip() for origin in os.getenv("FENCEPOST_ALLOWED_ORIGIN", "*").split(",")
    if origin.strip()
) or ("*",)


def _allow_origin(requested: str | None) -> str:
    """The access-control-allow-origin to return for this request.

    A match is echoed back as it came (`vary: origin` is already sent, so caches will not
    cross). A miss does not get a wildcard — that would make the setting pointless — but the
    first entry in the list: the browser still blocks it, and the response leaves a clue
    about who this deployment does accept.
    """
    if "*" in ALLOWED_ORIGINS:
        return "*"
    if requested and requested in ALLOWED_ORIGINS:
        return requested
    return ALLOWED_ORIGINS[0]


def _deps() -> Deps:
    # History, context, screening records and rate limits all go through SQLite; the
    # database file path comes from FENCEPOST_DB.
    global _DEPS
    if _DEPS is None:
        # Load .env and .env.local first. DashScope() does it too, but a few lines later, and
        # the hosted database address lives in .env.local — without reading it first this
        # picks up None locally and quietly falls back to a local file, looking perfectly
        # fine while doing so.
        load_env()
        # The address is chosen in this order:
        #   FENCEPOST_DB        explicit; used by tests and by a local file database
        #   TURSO_DATABASE_URL  the hosted database, injected by vercel integration add
        #   /tmp                the fallback on Vercel: one per instance, wiped on cold start
        #   local file          a development machine
        #
        # /tmp can only ever be the fallback: measured on 2026-09-13, one handle picked up
        # two different user_ids on two instances, and inside a single page load a
        # storyboard the dashboard had just listed came back 403 from timeline. SQLite on
        # serverless runs; it is not usable.
        default_db = ("/tmp/fencepost.db" if os.getenv("VERCEL")
                      else str(Path(__file__).resolve().parent.parent / "fencepost.db"))
        db = Database(os.getenv("FENCEPOST_DB")
                      or os.getenv("TURSO_DATABASE_URL")
                      or default_db)
        _DEPS = Deps(client=DashScope(), limiter=SqliteRateLimiter(db),
                     history=SqliteHistory(db), context=SqliteContext(db),
                     screening=SqliteScreeningLog(db), db=db)
    return _DEPS


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        # The newer Vercel Python builder recognises only the single entrypoint named in
        # pyproject.toml, so every path arrives here and the routing is done by hand.
        path = self.path.split("?")[0].rstrip("/") or "/"
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return self._json(400, {"error": {"code": "bad_request", "message": COPY["bad_request"]}})
        if path not in POST_ROUTES:
            # Route before building dependencies: an unknown address should not come back
            # 503 because some configuration is missing
            return self._json(404, {"error": {"code": "not_found", "message": COPY["not_found"]}})
        token = (self.headers.get("authorization") or "").removeprefix("Bearer ").strip()
        try:
            deps = _deps()
        except Exception as exc:
            # Missing configuration (no DASHSCOPE_API_KEY, say) should not take the whole
            # function down. This came out of a real deployment: after a crash Vercel says
            # only FUNCTION_INVOCATION_FAILED and the client learns nothing at all.
            print(f"[proxy] deps: {redact(str(exc))[:200]}", file=sys.stderr)
            return self._json(503, {"error": {"code": "upstream_unavailable",
                                              "message": COPY["upstream_unavailable"]}})
        if path == "/api/session":
            return self._json(*create_session(body, deps))
        if path == "/api/register":
            return self._json(*register(body, deps))
        if path == "/api/login":
            return self._json(*login(body, deps))
        if path == "/api/storyboards":
            return self._json(*create_storyboard(body, token, deps))
        if path == "/api/storyboards/close":
            return self._json(*close_storyboard(body, token, deps))
        if path == "/api/videos":
            return self._json(*register_video(body, token, deps))
        if path == "/api/entries":
            return self._json(*submit_entry(body, token, deps))
        if path == "/api/entries/edit":
            return self._json(*edit_entry(body, token, deps))
        if path == "/api/entries/delete":
            return self._json(*delete_entry(body, token, deps))
        if path == "/api/share-links":
            return self._json(*issue_share_link(body, token, deps))
        if path == "/api/share-links/redeem":
            return self._json(*redeem_share_link(body, token, deps))
        if path == "/api/share-links/revoke":
            return self._json(*revoke_share_link(body, token, deps))
        if path == "/api/grants/revoke":
            return self._json(*revoke_grant(body, token, deps))
        if path == "/api/forum/threads":
            return self._json(*create_thread(body, token, deps))
        if path == "/api/forum/posts/delete":
            return self._json(*delete_post(body, token, deps))
        if path == "/api/forum/posts":
            return self._json(*create_post(body, token, deps))
        if path == "/api/review/vote":
            return self._json(*cast_review_vote(body, token, deps))
        if path == "/api/review/dispose":
            return self._json(*dispose_entry(body, token, deps))
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
        self._json(*GET_ROUTES[path](params, token, deps))

    def _sse(self, body: dict, token: str, deps) -> None:
        status, result = handle_stream(body, token, deps)
        if status != 200:
            return self._json(status, result)
        self.send_response(200)
        self._cors()
        self.send_header("content-type", "text/event-stream")
        self.send_header("cache-control", "no-cache")
        self.send_header("x-accel-buffering", "no")     # stop a middlebox buffering the stream
        self.end_headers()
        self._event({"prompt_version": result.prompt_version})
        try:
            for piece in result:
                self._event({"delta": piece})
        except UpstreamError:
            # If it breaks mid-stream, send an error event and store nothing: half a reply
            # is a fabricated reply too.
            self._event({"error": {"code": "upstream_unavailable",
                                   "message": COPY["upstream_unavailable"]}})
            return
        result.finish()
        self._event({"done": True})

    def _event(self, payload: dict) -> None:
        """One SSE frame: starts with data:, ends with a blank line."""
        self.wfile.write(("data: " + json.dumps(payload) + "\n\n").encode())
        self.wfile.flush()

    def _cors(self) -> None:
        self.send_header("access-control-allow-origin", _allow_origin(self.headers.get("origin")))
        self.send_header("vary", "origin")

    def do_OPTIONS(self):
        """Preflight. A browser sending an authorization header always asks first."""
        self.send_response(204)
        self._cors()
        self.send_header("access-control-allow-methods", "GET, POST, OPTIONS")
        self.send_header("access-control-allow-headers", "authorization, content-type")
        self.send_header("access-control-max-age", "86400")
        self.end_headers()

    def _json(self, status: int, payload: dict) -> None:
        data = json.dumps(payload).encode()
        self.send_response(status)
        self._cors()
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        """The default logger writes request lines to stdout. Silenced, so the log is not another leak."""
