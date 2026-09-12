"""资源端点：签发令牌、建故事版。走真 HTTP，因为路径分发本身就是要验的东西。

Vercel 那边只有一个入口，所有路径都进同一个 handler，路由是我们自己分的。

    python tests/test_resources.py
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

import api.index as entry                                          # noqa: E402
from proxy.app import COPY, Deps                                   # noqa: E402
from proxy.db import (Database, SqliteContext, SqliteHistory,      # noqa: E402
                      SqliteScreeningLog)

OK_JSON = '{"verdict":"ok","codes":[],"note":""}'
REVIEW_JSON = '{"verdict":"review","codes":["fact_conflict"],"note":"off"}'
REJECT_JSON = '{"verdict":"reject","codes":["pii"],"note":"address named"}'


class FakeClient:
    chat_model = "fake-model"
    screener_model = "fake-screener"

    def __init__(self, *replies):
        self.replies = list(replies)

    def call(self, role, system, content, history=()):
        return self.replies.pop(0) if self.replies else "a reply"


class Resources(unittest.TestCase):
    def setUp(self):
        self.db = Database()
        self.client = FakeClient()
        entry._DEPS = Deps(client=self.client, db=self.db,
                           history=SqliteHistory(self.db), context=SqliteContext(self.db),
                           screening=SqliteScreeningLog(self.db))
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), entry.handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        os.environ["FENCEPOST_OPEN_SIGNUP"] = "1"

    def tearDown(self):
        self.server.shutdown()
        entry._DEPS = None
        os.environ.pop("FENCEPOST_OPEN_SIGNUP", None)

    def post(self, path, body, token=None):
        headers = {"content-type": "application/json"}
        if token:
            headers["authorization"] = "Bearer " + token
        request = urllib.request.Request(self.base + path, data=json.dumps(body).encode(),
                                         headers=headers)
        try:
            resp = urllib.request.urlopen(request)
        except urllib.error.HTTPError as err:
            resp = err
        return resp.status, json.loads(resp.read())

    def get(self, path, token=None):
        headers = {"authorization": "Bearer " + token} if token else {}
        request = urllib.request.Request(self.base + path, headers=headers)
        try:
            resp = urllib.request.urlopen(request)
        except urllib.error.HTTPError as err:
            resp = err
        return resp.status, json.loads(resp.read())

    def session(self, handle="neighbour-a"):
        return self.post("/api/session", {"handle": handle})[1]

    def test_signup_is_closed_unless_switched_on(self):
        os.environ.pop("FENCEPOST_OPEN_SIGNUP")
        status, payload = self.post("/api/session", {"handle": "neighbour-a"})
        self.assertEqual(403, status)
        self.assertEqual("signup_closed", payload["error"]["code"])

    def test_session_returns_a_usable_token(self):
        status, payload = self.post("/api/session", {"handle": "neighbour-a"})
        self.assertEqual(200, status)
        self.assertTrue(payload["token"].startswith(payload["user_id"] + "."))
        created, _ = self.post("/api/storyboards", {"title": "Fence at number 12"},
                               token=payload["token"])
        self.assertEqual(200, created)

    def test_the_same_handle_is_the_same_user(self):
        first, second = self.session(), self.session()
        self.assertEqual(first["user_id"], second["user_id"])
        self.assertEqual(1, self.db.conn.execute("SELECT COUNT(*) c FROM users").fetchone()["c"])

    def test_an_empty_handle_is_refused(self):
        for handle in ("", "   ", "x" * 41):
            with self.subTest(handle=handle[:8]):
                status, _ = self.post("/api/session", {"handle": handle})
                self.assertEqual(400, status)

    def test_creating_a_storyboard_needs_a_token(self):
        status, payload = self.post("/api/storyboards", {"title": "no token here"})
        self.assertEqual(401, status)
        self.assertEqual("unauthorized", payload["error"]["code"])

    def test_the_owner_can_reach_the_storyboard_they_just_created(self):
        token = self.session()["token"]
        _, created = self.post("/api/storyboards", {"title": "Fence at number 12"}, token=token)
        status, payload = self.post("/api/assistant",
                                    {"role": "neighbour", "storyboard_id": created["storyboard_id"],
                                     "message": "hello"}, token=token)
        self.assertEqual(200, status)
        self.assertEqual("a reply", payload["reply"])

    def test_someone_elses_storyboard_stays_out_of_reach(self):
        mine = self.session("neighbour-a")["token"]
        theirs = self.session("neighbour-b")["token"]
        _, created = self.post("/api/storyboards", {"title": "theirs"}, token=theirs)
        status, payload = self.post("/api/assistant",
                                    {"role": "neighbour", "storyboard_id": created["storyboard_id"],
                                     "message": "what is in here?"}, token=mine)
        self.assertEqual(403, status)
        self.assertEqual("no_access", payload["error"]["code"])

    def test_an_overlong_title_is_refused(self):
        token = self.session()["token"]
        status, _ = self.post("/api/storyboards", {"title": "x" * 121}, token=token)
        self.assertEqual(400, status)

    def test_an_unknown_path_is_404(self):
        status, payload = self.post("/api/nothing-here", {})
        self.assertEqual(404, status)
        self.assertEqual(COPY["not_found"], payload["error"]["message"])


class Entries(Resources):
    """提交 entry 与读时间线。沿用 Resources 的 fixture。"""

    def board(self, handle="owner"):
        who = self.session(handle)
        _, created = self.post("/api/storyboards", {"title": "Fence at number 12"},
                               token=who["token"])
        return who, created["storyboard_id"]

    def submit(self, token, storyboard_id, *replies, **over):
        self.client.replies = list(replies) or [OK_JSON]
        body = {"storyboard_id": storyboard_id, "species": "brushtail", "story": "saw one"}
        body.update(over)
        return self.post("/api/entries", body, token=token)

    def rows(self):
        return self.db.conn.execute("SELECT * FROM screening_results ORDER BY rowid").fetchall()

    def test_a_video_is_registered_against_its_owner(self):
        who = self.session()
        status, payload = self.post("/api/videos", {"storage_key": "uploads/2026/clip.mp4"},
                                    token=who["token"])
        self.assertEqual(200, status)
        self.assertEqual(who["user_id"], self.db.video_owner(payload["video_id"]))

    def test_someone_elses_video_cannot_be_attached(self):
        stranger = self.session("stranger")
        _, video = self.post("/api/videos", {"storage_key": "theirs.mp4"}, token=stranger["token"])
        who, board = self.board()
        status, payload = self.submit(who["token"], board, video_id=video["video_id"])
        self.assertEqual(403, status)
        self.assertEqual("no_access", payload["error"]["code"])

    def test_a_clean_entry_is_published_and_recorded(self):
        who, board = self.board()
        status, payload = self.submit(who["token"], board)
        self.assertEqual(200, status)
        self.assertTrue(payload["published"])
        row = self.rows()[0]
        self.assertEqual("entry", row["subject_type"])
        self.assertEqual(payload["entry_id"], row["subject_id"])

    def test_a_rejected_submission_creates_no_entry(self):
        who, board = self.board()
        status, payload = self.submit(who["token"], board, REJECT_JSON,
                                      story="He lives at 42 Example St.")
        self.assertEqual(200, status)
        self.assertFalse(payload["published"])
        self.assertEqual(["pii"], payload["reason_codes"])
        self.assertNotIn("entry_id", payload)
        self.assertEqual([], self.db.timeline(board))
        self.assertEqual("submission", self.rows()[0]["subject_type"])

    def test_a_flagged_entry_looks_exactly_like_a_clean_one(self):
        who, board = self.board()
        _, flagged = self.submit(who["token"], board, REVIEW_JSON)
        _, clean = self.submit(who["token"], board, OK_JSON)
        self.assertEqual(set(clean), set(flagged))
        self.assertTrue(flagged["published"])
        self.assertEqual("review", self.rows()[0]["verdict"])

    def test_both_fields_are_screened_separately(self):
        who, board = self.board()
        self.submit(who["token"], board, OK_JSON, OK_JSON,
                    fun_fact="Brushtails are nocturnal.", story="saw one on the fence")
        self.assertEqual(["fun_fact", "story"], [row["field"] for row in self.rows()])

    def test_a_viewer_cannot_add_an_entry(self):
        owner, board = self.board()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "view", owner["user_id"])
        status, payload = self.submit(guest["token"], board)
        self.assertEqual(403, status)
        self.assertEqual("read_only_access", payload["error"]["code"])

    def test_a_closed_storyboard_takes_no_new_entries(self):
        who, board = self.board()
        self.db.conn.execute("UPDATE storyboards SET status = 'readonly' WHERE id = ?", (board,))
        status, payload = self.submit(who["token"], board)
        self.assertEqual(409, status)
        self.assertEqual("storyboard_closed", payload["error"]["code"])

    def test_the_timeline_shows_every_contributor(self):
        owner, board = self.board()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "contribute", owner["user_id"])
        self.submit(guest["token"], board, OK_JSON, species="ringtail", story="theirs, in the tree")
        self.submit(owner["token"], board, OK_JSON, story="mine, on the fence")
        status, view = self.get(f"/api/timeline?storyboard_id={board}", token=owner["token"])
        self.assertEqual(200, status)
        self.assertEqual(["theirs, in the tree", "mine, on the fence"],
                         [e["story"] for e in view["entries"]])
        self.assertEqual(["guest", "owner"], [e["handle"] for e in view["entries"]])

    def test_the_timeline_and_the_assistant_see_different_things(self):
        owner, board = self.board()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "contribute", owner["user_id"])
        self.submit(guest["token"], board, OK_JSON, species="ringtail", story="theirs, in the tree")
        self.submit(owner["token"], board, OK_JSON, story="mine, on the fence")
        _, view = self.get(f"/api/timeline?storyboard_id={board}", token=owner["token"])
        context = SqliteContext(self.db).build(owner["user_id"], board)
        self.assertEqual(2, len(view["entries"]))
        self.assertEqual(["mine, on the fence"], [e["story"] for e in context["own_entries"]])

    def test_the_timeline_drops_soft_deleted_entries(self):
        who, board = self.board()
        _, first = self.submit(who["token"], board, OK_JSON, story="about to go")
        self.submit(who["token"], board, OK_JSON, story="still here")
        self.db.soft_delete_entry(first["entry_id"])
        _, view = self.get(f"/api/timeline?storyboard_id={board}", token=who["token"])
        self.assertEqual(["still here"], [e["story"] for e in view["entries"]])

    def test_the_timeline_needs_a_grant(self):
        _, board = self.board()
        stranger = self.session("stranger")
        status, payload = self.get(f"/api/timeline?storyboard_id={board}", token=stranger["token"])
        self.assertEqual(403, status)
        self.assertEqual("no_access", payload["error"]["code"])


if __name__ == "__main__":
    unittest.main()
