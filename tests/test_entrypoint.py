"""Entrypoint tests. Real HTTP, because the paths inside do_POST are not reachable from
the other tests.

The crash-on-missing-config case came from a real deployment: the function raised and
Vercel answered with nothing but FUNCTION_INVOCATION_FAILED. This pins it down.

    python tests/test_entrypoint.py
"""

import json
import os
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("FENCEPOST_TOKEN_SECRET", "test-secret")

import api.index as entry                             # noqa: E402
from proxy import auth                                    # noqa: E402
from proxy.app import COPY, Deps                          # noqa: E402
from proxy.model import UpstreamError                     # noqa: E402

VERSION = (ROOT / "prompts" / "VERSION").read_text(encoding="utf-8").strip()
TOKEN = auth.issue("u1")


class FakeClient:
    chat_model = "fake-model"

    def call(self, role, system, content, history=()):
        return "a reply"

    def stream(self, role, system, content, history=()):
        for piece in ("a ", "streamed ", "reply"):
            yield piece


class Entrypoint(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), entry.handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/api/assistant"
        deps = Deps(client=FakeClient())
        deps.context.grants.add(("u1", "s1"))
        entry._DEPS = deps

    def tearDown(self):
        self.server.shutdown()
        entry._DEPS = None

    def post(self, body, token=TOKEN, path=None):
        url = self.url if path is None else self.url.replace("/api/assistant", path)
        request = urllib.request.Request(
            url, data=json.dumps(body).encode(),
            headers={"content-type": "application/json", "authorization": "Bearer " + token})
        try:
            return urllib.request.urlopen(request)
        except urllib.error.HTTPError as err:
            return err

    def get(self, path, token=TOKEN):
        request = urllib.request.Request(
            self.url.replace("/api/assistant", path),
            headers={"authorization": "Bearer " + token})
        try:
            return urllib.request.urlopen(request)
        except urllib.error.HTTPError as err:
            return err

    def test_missing_config_is_503_not_a_crash(self):
        entry._DEPS = None

        def explode():
            raise UpstreamError("no_api_key")

        original, entry.DashScope = entry.DashScope, explode
        try:
            resp = self.post({"role": "screener", "field": "fun_fact", "submission": "x"})
            self.assertEqual(503, resp.status)
            self.assertEqual(COPY["upstream_unavailable"], json.loads(resp.read())["error"]["message"])
        finally:
            entry.DashScope = original

    def test_broken_json_is_400(self):
        request = urllib.request.Request(
            self.url, data=b"{not json",
            headers={"content-type": "application/json", "authorization": "Bearer " + TOKEN})
        try:
            resp = urllib.request.urlopen(request)
        except urllib.error.HTTPError as err:
            resp = err
        self.assertEqual(400, resp.status)

    def test_a_handler_that_raises_still_answers(self):
        """The defect this guards: BaseHTTPRequestHandler writes nothing on an unhandled
        exception, so the caller gets a closed connection rather than a status.

        Every CRUD route used to be dispatched from a twenty-branch if-chain sitting outside
        the only try/except in the method. proxy.app.handle() has a blanket except of its own,
        but it covers the assistant roles alone — everything reached through POST_ROUTES went
        to a bare function call. On Vercel that surfaces as FUNCTION_INVOCATION_FAILED, which
        tells the person at the fence nothing at all.
        """
        def explode(body, token, deps):
            raise RuntimeError("the database went away")

        original = entry.POST_ROUTES["/api/entries"]
        entry.POST_ROUTES["/api/entries"] = explode
        try:
            resp = self.post({"storyboard_id": "s1"}, path="/api/entries")
            self.assertEqual(500, resp.status)
            self.assertEqual(COPY["upstream_unavailable"],
                             json.loads(resp.read())["error"]["message"])
        finally:
            entry.POST_ROUTES["/api/entries"] = original

    def test_a_reader_that_raises_still_answers(self):
        """The same guard on the GET side, which had the same shape."""
        def explode(params, token, deps):
            raise RuntimeError("the database went away")

        original = entry.GET_ROUTES["/api/timeline"]
        entry.GET_ROUTES["/api/timeline"] = explode
        try:
            resp = self.get("/api/timeline?storyboard_id=s1")
            self.assertEqual(500, resp.status)
        finally:
            entry.GET_ROUTES["/api/timeline"] = original

    def test_an_id_that_is_not_a_string_is_a_bad_request(self):
        """A client sending an object where an id belongs has made a bad request.

        No handler type-checks its id fields; they pass the value into a query and let the
        driver raise, which without the guard above ended the request with no response and
        with the guard would be a 500. Neither is true: 400 is.
        """
        for body in ({"entry_id": {}}, {"storyboard_id": ["s1"]}, {"thread_id": 7}):
            with self.subTest(body=body):
                resp = self.post(body, path="/api/entries/delete")
                self.assertEqual(400, resp.status)

    def test_json_that_is_not_an_object_is_a_bad_request(self):
        """`[]` and `"hello"` are valid JSON and not bodies. Every handler downstream opens
        with body.get(...), which is an AttributeError on a list."""
        for raw in (b"[]", b'"hello"', b"42"):
            with self.subTest(raw=raw):
                request = urllib.request.Request(
                    self.url, data=raw,
                    headers={"content-type": "application/json",
                             "authorization": "Bearer " + TOKEN})
                try:
                    resp = urllib.request.urlopen(request)
                except urllib.error.HTTPError as err:
                    resp = err
                self.assertEqual(400, resp.status)

    def test_json_round_trip(self):
        resp = self.post({"role": "neighbour", "storyboard_id": "s1", "message": "hello"})
        self.assertEqual(200, resp.status)
        self.assertEqual("application/json", resp.headers.get("content-type"))
        payload = json.loads(resp.read())
        self.assertEqual("a reply", payload["reply"])
        self.assertEqual(VERSION, payload["prompt_version"])

    def test_stream_round_trip(self):
        resp = self.post({"role": "neighbour", "storyboard_id": "s1",
                          "message": "hello", "stream": True})
        self.assertEqual(200, resp.status)
        self.assertEqual("text/event-stream", resp.headers.get("content-type"))
        frames = [json.loads(line.decode()[6:]) for line in resp if line.strip()]
        self.assertEqual({"prompt_version": VERSION}, frames[0])
        self.assertEqual("a streamed reply", "".join(f["delta"] for f in frames if "delta" in f))
        self.assertEqual({"done": True}, frames[-1])


class Cors(unittest.TestCase):
    """Two Vercel projects means cross-origin, and a browser sends a preflight first."""

    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), entry.handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/api/assistant"
        deps = Deps(client=FakeClient())
        deps.context.grants.add(("u1", "s1"))
        entry._DEPS = deps

    def tearDown(self):
        self.server.shutdown()
        entry._DEPS = None

    def test_preflight_allows_the_authorization_header(self):
        request = urllib.request.Request(self.url, method="OPTIONS")
        with urllib.request.urlopen(request) as resp:
            self.assertEqual(204, resp.status)
            self.assertEqual("*", resp.headers.get("access-control-allow-origin"))
            self.assertIn("authorization", resp.headers.get("access-control-allow-headers"))
            self.assertIn("POST", resp.headers.get("access-control-allow-methods"))

    def test_answers_carry_the_origin_header(self):
        request = urllib.request.Request(
            self.url, data=json.dumps({"role": "neighbour", "storyboard_id": "s1",
                                       "message": "hello"}).encode(),
            headers={"content-type": "application/json", "authorization": "Bearer " + TOKEN})
        with urllib.request.urlopen(request) as resp:
            self.assertEqual("*", resp.headers.get("access-control-allow-origin"))


class WhichOriginIsAllowed(unittest.TestCase):
    """FENCEPOST_ALLOWED_ORIGIN takes a list, because one front end carries several
    production aliases.

    _allow_origin is tested directly: it reads a module-level constant fixed at import
    time, so changing the environment variable after the server starts is already too late.
    """

    def choose(self, configured, requested):
        original = entry.ALLOWED_ORIGINS
        entry.ALLOWED_ORIGINS = tuple(o.strip() for o in configured.split(",") if o.strip())
        try:
            return entry._allow_origin(requested)
        finally:
            entry.ALLOWED_ORIGINS = original

    def test_unset_still_means_a_star(self):
        """Local development and both tests above rely on this default; tightening the
        production configuration should not quietly break it.
        """
        self.assertEqual("*", self.choose("*", "https://anything.example"))

    def test_a_listed_alias_is_echoed_back(self):
        self.assertEqual(
            "https://b.example",
            self.choose("https://a.example, https://b.example", "https://b.example"))

    def test_an_unlisted_origin_does_not_get_a_star(self):
        """A wildcard makes the setting pointless."""
        self.assertEqual(
            "https://a.example",
            self.choose("https://a.example, https://b.example", "https://evil.example"))

    def test_no_origin_header_at_all_is_fine(self):
        """Server-to-server calls carry no Origin — verify_deployment.py runs exactly that way."""
        self.assertEqual("https://a.example", self.choose("https://a.example", None))


if __name__ == "__main__":
    unittest.main()
