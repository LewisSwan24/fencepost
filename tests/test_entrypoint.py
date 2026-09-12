"""入口层测试。走真 HTTP，因为 do_POST 里那几条路径别的测试碰不到。

缺配置崩掉那一条是真部署打出来的：函数直接抛异常，Vercel 只回一句
FUNCTION_INVOCATION_FAILED。这里把它钉住。

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


if __name__ == "__main__":
    unittest.main()
