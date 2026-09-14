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

    def post(self, body, token=TOKEN):
        request = urllib.request.Request(
            self.url, data=json.dumps(body).encode(),
            headers={"content-type": "application/json", "authorization": "Bearer " + token})
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
