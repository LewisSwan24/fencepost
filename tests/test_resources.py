"""Resource endpoints: issuing a token, creating a storyboard. Real HTTP, because the
path dispatch is itself part of what is being checked.

Vercel has one entrypoint, every path lands in the same handler, and the routing is ours.

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
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("FENCEPOST_TOKEN_SECRET", "test-secret")

import api.index as entry                                          # noqa: E402
from proxy.app import COPY, FUN_FACT_LIMIT, STORY_LIMIT, Deps      # noqa: E402
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
        self.calls = []

    def call(self, role, system, content, history=()):
        self.calls.append({"role": role, "content": content})
        return self.replies.pop(0) if self.replies else "a reply"


class Fixture(unittest.TestCase):
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

    def with_entry(self, story="mine, on the fence"):
        who, board = self.board()
        _, created = self.submit(who["token"], board, OK_JSON, story=story)
        return who, board, created["entry_id"]

    def assistant_sees(self, token, board):
        self.client.calls.clear()
        self.client.replies = []
        self.post("/api/assistant", {"role": "neighbour", "storyboard_id": board,
                                     "message": "what did I write?"}, token=token)
        return json.dumps(self.client.calls[-1], ensure_ascii=False)


class Resources(Fixture):
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


class Entries(Fixture):
    """Posting an entry and reading the timeline. Reuses the Resources fixture."""

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


class TheShapeOfAnEntry(Fixture):
    """fun_fact and story are free text that reaches a model and then the database.

    They were the only free text in the product that skipped _plain_text, because they
    are screened and that was taken for protection. The Screener judges what writing
    says, not what shape it arrives in.

    Measured on 2026-09-14, before the fix: a list in `story` reached the INSERT and took
    the whole function down with a ProgrammingError and no response at all, which on
    Vercel is FUNCTION_INVOCATION_FAILED and nothing the client can read. An integer was
    stored as an integer. 200,000 characters were stored, and sent to the model on the
    way in.
    """

    def setUp(self):
        super().setUp()
        who, self.board_id = self.board()
        self.token = who["token"]

    def submit(self, **fields):
        body = {"storyboard_id": self.board_id, "species": "ringtail"}
        body.update(fields)
        return self.post("/api/entries", body, token=self.token)

    def stored(self):
        _, view = self.get(f"/api/timeline?storyboard_id={self.board_id}",
                           token=self.token)
        return view.get("entries", [])

    def test_a_list_is_refused_rather_than_killing_the_function(self):
        status, out = self.submit(story=["on the fence", "at eleven"])
        self.assertEqual(400, status)
        self.assertEqual("bad_request", out["error"]["code"])
        self.assertEqual([], self.stored())

    def test_a_number_is_not_a_fun_fact(self):
        status, _ = self.submit(fun_fact=42, story="on the fence")
        self.assertEqual(400, status, "an integer was stored as an integer")
        self.assertEqual([], self.stored())

    def test_a_story_longer_than_the_cap_is_refused(self):
        status, _ = self.submit(story="o" * (STORY_LIMIT + 1))
        self.assertEqual(400, status)
        self.assertEqual([], self.stored())

    def test_a_story_exactly_at_the_cap_is_allowed(self):
        """The boundary belongs to the user, not to the validator."""
        status, out = self.submit(story="o" * STORY_LIMIT)
        self.assertEqual(200, status)
        self.assertTrue(out["published"])

    def test_a_fun_fact_longer_than_the_cap_is_refused(self):
        status, _ = self.submit(fun_fact="f" * (FUN_FACT_LIMIT + 1), story="on the fence")
        self.assertEqual(400, status)
        self.assertEqual([], self.stored())

    def test_a_hidden_control_character_is_refused(self):
        """Built with chr() rather than an escape: a real one in the source would stop
        Python compiling the file at all.
        """
        status, _ = self.submit(story="on the fence" + chr(7))
        self.assertEqual(400, status)

    def test_newlines_are_still_allowed(self):
        """A story is multiline. Refusing control characters must not refuse a paragraph
        break, or the cure is worse than the disease.
        """
        status, out = self.submit(story="on the fence" + chr(10) + "then the jacaranda")
        self.assertEqual(200, status)
        self.assertTrue(out["published"])

    def test_whitespace_alone_is_not_a_sighting(self):
        status, _ = self.submit(story="    ")
        self.assertEqual(400, status, "a blank entry would render as an unexplained gap")

    def test_the_text_is_stored_stripped(self):
        self.submit(story="   on the fence at eleven   ")
        self.assertEqual("on the fence at eleven", self.stored()[0]["story"])

    def test_an_edit_cannot_smuggle_in_what_a_submission_cannot(self):
        """The edit path reads the same two fields and had the same hole."""
        self.submit(story="on the fence at eleven")
        entry_id = self.stored()[0]["id"]
        for bad in (["a", "b"], 42, "o" * (STORY_LIMIT + 1), "on the fence" + chr(7)):
            status, _ = self.post("/api/entries/edit",
                                  {"entry_id": entry_id, "story": bad}, token=self.token)
            self.assertEqual(400, status, f"{type(bad).__name__} got through the edit path")
        self.assertEqual("on the fence at eleven", self.stored()[0]["story"],
                         "a refused edit changed the stored text")


class Edits(Fixture):
    """Editing and deleting. What matters is immediacy: the next assistant call sees it."""

    def test_the_author_can_delete_and_the_timeline_drops_it(self):
        who, board, entry_id = self.with_entry()
        status, payload = self.post("/api/entries/delete", {"entry_id": entry_id},
                                    token=who["token"])
        self.assertEqual(200, status)
        self.assertTrue(payload["deleted"])
        _, view = self.get(f"/api/timeline?storyboard_id={board}", token=who["token"])
        self.assertEqual([], view["entries"])

    def test_a_deleted_entry_leaves_the_assistant_context_at_once(self):
        who, board, entry_id = self.with_entry("mine, on the fence")
        self.assertIn("mine, on the fence", self.assistant_sees(who["token"], board))
        self.post("/api/entries/delete", {"entry_id": entry_id}, token=who["token"])
        self.assertNotIn("mine, on the fence", self.assistant_sees(who["token"], board))

    def test_another_contributor_cannot_delete_it(self):
        owner, board, entry_id = self.with_entry()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "contribute", owner["user_id"])
        status, payload = self.post("/api/entries/delete", {"entry_id": entry_id},
                                    token=guest["token"])
        self.assertEqual(403, status)
        self.assertEqual("not_your_entry", payload["error"]["code"])

    def test_deleting_twice_is_gone(self):
        who, _, entry_id = self.with_entry()
        self.post("/api/entries/delete", {"entry_id": entry_id}, token=who["token"])
        status, payload = self.post("/api/entries/delete", {"entry_id": entry_id},
                                    token=who["token"])
        self.assertEqual(404, status)
        self.assertEqual("gone", payload["error"]["code"])

    def test_an_edit_is_screened_and_applied(self):
        who, board, entry_id = self.with_entry("saw one")
        self.client.replies = [OK_JSON]
        status, payload = self.post("/api/entries/edit",
                                    {"entry_id": entry_id, "story": "saw one on the fence"},
                                    token=who["token"])
        self.assertEqual(200, status)
        self.assertTrue(payload["published"])
        self.assertEqual("story", self.rows()[-1]["field"])
        self.assertIn("saw one on the fence", self.assistant_sees(who["token"], board))

    def test_a_rejected_edit_leaves_the_original_alone(self):
        who, board, entry_id = self.with_entry("saw one")
        self.client.replies = [REJECT_JSON]
        status, payload = self.post("/api/entries/edit",
                                    {"entry_id": entry_id, "story": "He lives at 42 Example St."},
                                    token=who["token"])
        self.assertEqual(200, status)
        self.assertFalse(payload["published"])
        self.assertEqual("saw one", self.db.entry(entry_id)["story"])
        self.assertIn("saw one", self.assistant_sees(who["token"], board))

    def test_an_edit_that_changes_nothing_skips_the_screener(self):
        who, _, entry_id = self.with_entry("saw one")
        self.client.calls.clear()
        _, payload = self.post("/api/entries/edit", {"entry_id": entry_id, "story": "saw one"},
                               token=who["token"])
        self.assertTrue(payload["unchanged"])
        self.assertEqual([], self.client.calls)

    def test_a_closed_storyboard_takes_no_edits(self):
        who, board, entry_id = self.with_entry()
        self.db.conn.execute("UPDATE storyboards SET status = 'archived' WHERE id = ?", (board,))
        status, payload = self.post("/api/entries/edit", {"entry_id": entry_id, "story": "later"},
                                    token=who["token"])
        self.assertEqual(409, status)
        self.assertEqual("storyboard_closed", payload["error"]["code"])


class Sharing(Fixture):
    """A QR link carrying an access level: issue, redeem, revoke."""

    def link(self, token, storyboard_id, **over):
        body = {"storyboard_id": storyboard_id}
        body.update(over)
        return self.post("/api/share-links", body, token=token)

    def links(self, token, storyboard_id):
        return self.get(f"/api/share-links?storyboard_id={storyboard_id}", token=token)

    def test_the_listing_never_carries_the_token(self):
        """The database holds only a hash; the plaintext existed once, at issue time.

        This is not something withheld: an endpoint that could fetch a code back afterwards
        would leave a redeemable grant hanging on a screen.
        """
        owner, board = self.board()
        _, issued = self.link(owner["token"], board)
        status, listing = self.links(owner["token"], board)
        self.assertEqual(200, status)
        self.assertEqual(1, len(listing["links"]))
        self.assertNotIn(issued["token"], json.dumps(listing))
        self.assertNotIn("token", listing["links"][0])
        self.assertNotIn("token_hash", listing["links"][0])

    def test_a_revoked_link_stays_on_the_list(self):
        """The opposite of grants, deliberately: once a code is turned off the owner
        has to be able to see that it worked.
        """
        owner, board = self.board()
        _, issued = self.link(owner["token"], board)
        self.post("/api/share-links/revoke", {"share_link_id": issued["share_link_id"]},
                  token=owner["token"])
        _, listing = self.links(owner["token"], board)
        self.assertEqual(1, len(listing["links"]))
        self.assertIsNotNone(listing["links"][0]["revoked_at"])

    def test_listing_needs_reshare_like_issuing_does(self):
        """Only somebody who can issue should see what has been issued."""
        owner, board = self.board()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "contribute", owner["user_id"])
        status, payload = self.links(guest["token"], board)
        self.assertEqual(403, status)
        self.assertEqual("cannot_share", payload["error"]["code"])

    def test_the_listing_says_who_owns_the_storyboard(self):
        """Revoking takes either the owner or the issuer, and the interface uses this
        field to decide who gets the button.
        """
        owner, board = self.board()
        self.link(owner["token"], board)
        _, listing = self.links(owner["token"], board)
        self.assertEqual(owner["user_id"], listing["owner_id"])
        self.assertEqual(owner["handle"], listing["links"][0]["created_by_handle"])

    def test_turning_off_a_code_leaves_the_access_it_already_handed_out(self):
        """The sentence in the interface is written from this: turning a code off
        stops the people who have not used it yet.

        The share screen puts turning a code off and revoking access on one page, and
        saying it unclearly is how somebody comes to believe they closed a door. This pins
        down that the server really behaves that way.
        """
        owner, board = self.board()
        guest = self.session("guest")
        _, issued = self.link(owner["token"], board, level="contribute")
        self.post("/api/share-links/redeem", {"token": issued["token"]}, token=guest["token"])
        self.assertEqual("contribute", self.db.grant_level(board, guest["user_id"]))

        self.post("/api/share-links/revoke", {"share_link_id": issued["share_link_id"]},
                  token=owner["token"])
        self.assertEqual("contribute", self.db.grant_level(board, guest["user_id"]),
                         "turning a code off also revoked access that had already been redeemed")

    def test_a_turned_off_code_cannot_be_redeemed_again(self):
        owner, board = self.board()
        _, issued = self.link(owner["token"], board)
        self.post("/api/share-links/revoke", {"share_link_id": issued["share_link_id"]},
                  token=owner["token"])
        latecomer = self.session("latecomer")
        status, payload = self.post("/api/share-links/redeem", {"token": issued["token"]},
                                    token=latecomer["token"])
        self.assertEqual(403, status)
        self.assertEqual("link_revoked", payload["error"]["code"])

    def test_the_person_who_made_a_code_can_turn_it_off_without_being_owner(self):
        """The server gate is created_by or owner, not reshare — the interface matches."""
        owner, board = self.board()
        resharer = self.session("resharer")
        self.db.grant(board, resharer["user_id"], "reshare", owner["user_id"])
        _, theirs = self.link(resharer["token"], board, level="view")
        status, _ = self.post("/api/share-links/revoke",
                              {"share_link_id": theirs["share_link_id"]},
                              token=resharer["token"])
        self.assertEqual(200, status)

    def test_a_resharer_cannot_turn_off_someone_elses_code(self):
        owner, board = self.board()
        resharer = self.session("resharer")
        self.db.grant(board, resharer["user_id"], "reshare", owner["user_id"])
        _, mine = self.link(owner["token"], board)
        status, payload = self.post("/api/share-links/revoke",
                                    {"share_link_id": mine["share_link_id"]},
                                    token=resharer["token"])
        self.assertEqual(403, status)
        self.assertEqual("not_the_owner", payload["error"]["code"])

    def test_only_the_hash_is_stored(self):
        owner, board = self.board()
        _, issued = self.link(owner["token"], board)
        row = self.db.share_link(issued["share_link_id"])
        self.assertNotEqual(issued["token"], row["token_hash"])
        self.assertEqual(64, len(row["token_hash"]))
        rows = self.db.conn.execute("SELECT * FROM share_links").fetchall()
        self.assertNotIn(issued["token"], json.dumps([dict(r) for r in rows]))

    def test_redeeming_grants_the_level_the_link_carries(self):
        owner, board = self.board()
        _, issued = self.link(owner["token"], board, level="contribute")
        guest = self.session("guest")
        status, redeemed = self.post("/api/share-links/redeem", {"token": issued["token"]},
                                     token=guest["token"])
        self.assertEqual(200, status)
        self.assertEqual("contribute", redeemed["level"])
        submitted, _ = self.submit(guest["token"], board, OK_JSON)
        self.assertEqual(200, submitted)

    def test_a_view_link_cannot_write(self):
        owner, board = self.board()
        _, issued = self.link(owner["token"], board, level="view")
        guest = self.session("guest")
        self.post("/api/share-links/redeem", {"token": issued["token"]}, token=guest["token"])
        status, payload = self.submit(guest["token"], board)
        self.assertEqual(403, status)
        self.assertEqual("read_only_access", payload["error"]["code"])

    def test_a_contributor_cannot_hand_out_access(self):
        owner, board = self.board()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "contribute", owner["user_id"])
        status, payload = self.link(guest["token"], board)
        self.assertEqual(403, status)
        self.assertEqual("cannot_share", payload["error"]["code"])

    def test_an_expired_link_is_refused(self):
        owner, board = self.board()
        _, issued = self.link(owner["token"], board)
        self.db.conn.execute("UPDATE share_links SET expires_at = ? WHERE id = ?",
                             ("2020-01-01T00:00:00+00:00", issued["share_link_id"]))
        guest = self.session("guest")
        status, payload = self.post("/api/share-links/redeem", {"token": issued["token"]},
                                    token=guest["token"])
        self.assertEqual(403, status)
        self.assertEqual("link_expired", payload["error"]["code"])

    def test_a_used_up_link_is_refused(self):
        owner, board = self.board()
        _, issued = self.link(owner["token"], board, max_uses=1)
        first = self.session("first")
        second = self.session("second")
        self.post("/api/share-links/redeem", {"token": issued["token"]}, token=first["token"])
        status, payload = self.post("/api/share-links/redeem", {"token": issued["token"]},
                                    token=second["token"])
        self.assertEqual(403, status)
        self.assertEqual("link_used_up", payload["error"]["code"])

    def test_a_revoked_link_stops_working_at_once(self):
        owner, board = self.board()
        _, issued = self.link(owner["token"], board)
        self.post("/api/share-links/revoke", {"share_link_id": issued["share_link_id"]},
                  token=owner["token"])
        guest = self.session("guest")
        status, payload = self.post("/api/share-links/redeem", {"token": issued["token"]},
                                    token=guest["token"])
        self.assertEqual(403, status)
        self.assertEqual("link_revoked", payload["error"]["code"])

    def test_an_unknown_token_is_not_found(self):
        guest = self.session("guest")
        status, payload = self.post("/api/share-links/redeem", {"token": "made-up"},
                                    token=guest["token"])
        self.assertEqual(404, status)
        self.assertEqual("invalid_link", payload["error"]["code"])

    def test_redeeming_grants_and_counts_in_one_write(self):
        """Granting and counting the use have to land together.

        It used to be two calls each committing separately: grant, then consume_share_link.
        A failure in between let somebody in without the use being counted, so a link with
        max_uses=3 could admit a fourth person — and in a product built on permissioned
        sharing, one person too many is worse than one too few. This pins down both effects.
        """
        owner, board = self.board("owner")
        _, link = self.post("/api/share-links",
                            {"storyboard_id": board, "level": "contribute", "max_uses": 1},
                            token=owner["token"])
        guest = self.session("guest")
        status, granted = self.post("/api/share-links/redeem", {"token": link["token"]},
                                    token=guest["token"])
        self.assertEqual(200, status)
        self.assertEqual("contribute", granted["level"])
        self.assertEqual("contribute", self.db.grant_level(board, guest["user_id"]))
        self.assertEqual(1, self.db.share_link(link["share_link_id"])["used_count"])

        # Once max_uses is spent, a second person cannot get in and the count stops moving
        other = self.session("other")
        status, _ = self.post("/api/share-links/redeem", {"token": link["token"]},
                              token=other["token"])
        self.assertEqual(403, status)
        self.assertIsNone(self.db.grant_level(board, other["user_id"]))
        self.assertEqual(1, self.db.share_link(link["share_link_id"])["used_count"])

    def test_redeeming_never_downgrades(self):
        owner, board = self.board()
        _, issued = self.link(owner["token"], board, level="view")
        _, redeemed = self.post("/api/share-links/redeem", {"token": issued["token"]},
                                token=owner["token"])
        self.assertEqual("reshare", redeemed["level"])
        self.assertEqual("reshare", self.db.grant_level(board, owner["user_id"]))

    def test_the_owner_can_revoke_a_grant_and_access_stops(self):
        owner, board = self.board()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "contribute", owner["user_id"])
        seen, _ = self.get(f"/api/timeline?storyboard_id={board}", token=guest["token"])
        self.assertEqual(200, seen)
        self.post("/api/grants/revoke", {"storyboard_id": board, "user_id": guest["user_id"]},
                  token=owner["token"])
        status, payload = self.get(f"/api/timeline?storyboard_id={board}", token=guest["token"])
        self.assertEqual(403, status)
        self.assertEqual("no_access", payload["error"]["code"])

    def test_only_the_owner_revokes(self):
        owner, board = self.board()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "reshare", owner["user_id"])
        status, payload = self.post("/api/grants/revoke",
                                    {"storyboard_id": board, "user_id": owner["user_id"]},
                                    token=guest["token"])
        self.assertEqual(403, status)
        self.assertEqual("not_the_owner", payload["error"]["code"])


class Dashboard(Fixture):
    """The storyboards I can reach, active and past kept apart."""

    def view(self, token):
        return self.get("/api/dashboard", token=token)[1]

    def test_it_lists_only_what_i_can_reach(self):
        owner, mine = self.board("owner")
        stranger, theirs = self.board("stranger")
        view = self.view(owner["token"])
        self.assertEqual([mine], [b["id"] for b in view["active"]])
        self.assertEqual([theirs], [b["id"] for b in self.view(stranger["token"])["active"]])

    def test_archived_storyboards_move_to_past(self):
        owner, board = self.board()
        self.assertEqual(1, len(self.view(owner["token"])["active"]))
        self.db.conn.execute("UPDATE storyboards SET status = 'readonly' WHERE id = ?", (board,))
        view = self.view(owner["token"])
        self.assertEqual([], view["active"])
        self.assertEqual([board], [b["id"] for b in view["past"]])

    def test_a_revoked_grant_drops_it_from_the_list(self):
        owner, board = self.board()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "contribute", owner["user_id"])
        self.assertEqual(1, len(self.view(guest["token"])["active"]))
        self.post("/api/grants/revoke", {"storyboard_id": board, "user_id": guest["user_id"]},
                  token=owner["token"])
        self.assertEqual([], self.view(guest["token"])["active"])

    def test_it_says_nothing_about_the_other_contributors(self):
        owner, board = self.board()
        guest = self.session("neighbour-with-a-name")
        self.db.grant(board, guest["user_id"], "contribute", owner["user_id"])
        self.submit(guest["token"], board, OK_JSON, story="theirs")
        payload = json.dumps(self.view(owner["token"]), ensure_ascii=False)
        self.assertNotIn("neighbour-with-a-name", payload)
        self.assertNotIn(guest["user_id"], payload)

    def test_the_entry_count_leaves_out_deleted_ones(self):
        owner, board = self.board()
        _, first = self.submit(owner["token"], board, OK_JSON, story="one")
        self.submit(owner["token"], board, OK_JSON, story="two")
        self.assertEqual(2, self.view(owner["token"])["active"][0]["entry_count"])
        self.db.soft_delete_entry(first["entry_id"])
        self.assertEqual(1, self.view(owner["token"])["active"][0]["entry_count"])

    def test_the_latest_species_is_the_most_recent_entry(self):
        """The list cover is chosen from this, so it has to be the most recent entry."""
        owner, board = self.board()
        self.submit(owner["token"], board, OK_JSON, species="brushtail", story="one")
        self.submit(owner["token"], board, OK_JSON, species="ringtail", story="two")
        self.assertEqual("ringtail", self.view(owner["token"])["active"][0]["latest_species"])

    def test_an_empty_storyboard_has_no_latest_species(self):
        """No entries means no cover. A default species would assert on the user's
        behalf what they filmed.
        """
        owner, board = self.board()
        self.assertIsNone(self.view(owner["token"])["active"][0]["latest_species"])

    def test_the_latest_species_skips_deleted_entries(self):
        """A soft delete takes effect at once (CLAUDE.md safety line), so the cover
        cannot keep that entry's species.
        """
        owner, board = self.board()
        self.submit(owner["token"], board, OK_JSON, species="brushtail", story="one")
        _, newest = self.submit(owner["token"], board, OK_JSON, species="ringtail", story="two")
        self.db.soft_delete_entry(newest["entry_id"])
        self.assertEqual("brushtail", self.view(owner["token"])["active"][0]["latest_species"])

    def test_my_level_comes_back_with_each_one(self):
        owner, board = self.board()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "view", owner["user_id"])
        self.assertEqual("reshare", self.view(owner["token"])["active"][0]["level"])
        self.assertEqual("view", self.view(guest["token"])["active"][0]["level"])


class Closing(Fixture):
    """The owner closing it deliberately."""

    def test_the_owner_can_close_with_a_note(self):
        owner, board = self.board()
        status, payload = self.post("/api/storyboards/close",
                                    {"storyboard_id": board,
                                     "closed_note": "that was the last of them"},
                                    token=owner["token"])
        self.assertEqual(200, status)
        self.assertEqual("archived", payload["status"])
        self.assertEqual([board], [b["id"] for b in self.get("/api/dashboard",
                                                             token=owner["token"])[1]["past"]])

    def test_the_closing_note_comes_back_to_everyone_who_can_reach_it(self):
        """The closing line used to be written and never read: stored, echoed once in
        the close response, and invisible after that.
        """
        owner, board = self.board()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "view", owner["user_id"])
        self.post("/api/storyboards/close",
                  {"storyboard_id": board, "closed_note": "that was the last of them"},
                  token=owner["token"])
        for who in (owner, guest):
            past = self.get("/api/dashboard", token=who["token"])[1]["past"]
            self.assertEqual(["that was the last of them"],
                             [b["closed_note"] for b in past])

    def test_closing_without_a_note_leaves_it_empty_not_blank(self):
        owner, board = self.board()
        self.post("/api/storyboards/close", {"storyboard_id": board, "closed_note": "  "},
                  token=owner["token"])
        past = self.get("/api/dashboard", token=owner["token"])[1]["past"]
        self.assertIsNone(past[0]["closed_note"])

    def test_an_overlong_closing_note_is_refused(self):
        owner, board = self.board()
        status, _ = self.post("/api/storyboards/close",
                              {"storyboard_id": board, "closed_note": "x" * 281},
                              token=owner["token"])
        self.assertEqual(400, status)

    def test_only_the_owner_closes(self):
        owner, board = self.board()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "reshare", owner["user_id"])
        status, payload = self.post("/api/storyboards/close", {"storyboard_id": board},
                                    token=guest["token"])
        self.assertEqual(403, status)
        self.assertEqual("not_the_owner", payload["error"]["code"])

    def test_a_closed_storyboard_still_reads(self):
        owner, board = self.board()
        self.submit(owner["token"], board, OK_JSON, story="before closing")
        self.post("/api/storyboards/close", {"storyboard_id": board}, token=owner["token"])
        status, view = self.get(f"/api/timeline?storyboard_id={board}", token=owner["token"])
        self.assertEqual(200, status)
        self.assertEqual(["before closing"], [e["story"] for e in view["entries"]])


class Forum(Fixture):
    """Threads hang off a storyboard, access follows it, and the assistant never sees them."""

    def thread(self, token, storyboard_id, reply=OK_JSON, **over):
        self.client.replies = [reply]
        body = {"storyboard_id": storyboard_id, "title": "Who else hears it at 2am",
                "body": "there is something walking on my roof every night"}
        body.update(over)
        return self.post("/api/forum/threads", body, token=token)

    def test_a_thread_is_created_and_listed(self):
        owner, board = self.board()
        status, created = self.thread(owner["token"], board)
        self.assertEqual(200, status)
        self.assertTrue(created["published"])
        _, listing = self.get(f"/api/forum?storyboard_id={board}", token=owner["token"])
        self.assertEqual(["Who else hears it at 2am"], [t["title"] for t in listing["threads"]])
        self.assertEqual(1, listing["threads"][0]["post_count"])

    def test_the_title_goes_through_the_screener_with_the_post(self):
        """The title used to go unchecked. Joined into one piece, it costs one model call."""
        owner, board = self.board()
        self.thread(owner["token"], board, title="Who else hears it at 2am")
        screener_calls = [c for c in self.client.calls if c["role"] == "screener"]
        self.assertEqual(1, len(screener_calls))
        sent = screener_calls[0]["content"]
        self.assertIn("Who else hears it at 2am", sent)
        self.assertIn("there is something walking on my roof", sent)

    def test_a_clean_body_does_not_rescue_an_address_in_the_title(self):
        """This is the reason that change exists."""
        owner, board = self.board()
        status, payload = self.thread(owner["token"], board, REJECT_JSON,
                                      title="Anyone seen the one at 42 Example St")
        self.assertEqual(200, status)
        self.assertFalse(payload["published"])
        self.assertEqual(["pii"], payload["reason_codes"])
        _, listing = self.get(f"/api/forum?storyboard_id={board}", token=owner["token"])
        self.assertEqual([], listing["threads"])

    def test_the_audit_row_holds_exactly_what_the_model_read(self):
        """Looking back later, the stored text has to match what the model judged."""
        owner, board = self.board()
        self.thread(owner["token"], board, REJECT_JSON, title="Anyone seen the one at 42 Example St")
        row = self.rows()[-1]
        self.assertIn("42 Example St", row["original_text"])
        self.assertIn("walking on my roof", row["original_text"])

    def test_a_title_of_only_spaces_is_refused(self):
        owner, board = self.board()
        status, payload = self.thread(owner["token"], board, title="   ")
        self.assertEqual(400, status)
        self.assertEqual("bad_request", payload["error"]["code"])

    def test_a_title_carrying_control_characters_is_refused(self):
        """Once stored it shows up in the interface as something nobody can make sense
        of, so it is better refused on the spot.

        The character is assembled with chr() rather than written as an escape: a real NUL
        in the source file makes Python refuse to compile at all, which is exactly what
        happened while writing this on 2026-09-14.
        """
        owner, board = self.board()
        for bad in (chr(7), chr(0), chr(27), chr(0x7f)):
            with self.subTest(code=ord(bad)):
                status, _ = self.thread(owner["token"], board, title=f"two am{bad} roof")
                self.assertEqual(400, status)

    def test_a_title_that_is_not_text_is_refused_not_crashed(self):
        owner, board = self.board()
        status, _ = self.thread(owner["token"], board, title={"nope": 1})
        self.assertEqual(400, status)

    def test_a_rejected_post_creates_nothing(self):
        owner, board = self.board()
        status, payload = self.thread(owner["token"], board, reply=REJECT_JSON,
                                      body="He lives at 42 Example St.")
        self.assertEqual(200, status)
        self.assertFalse(payload["published"])
        self.assertEqual(["pii"], payload["reason_codes"])
        _, listing = self.get(f"/api/forum?storyboard_id={board}", token=owner["token"])
        self.assertEqual([], listing["threads"])

    def test_replies_land_in_order(self):
        owner, board = self.board()
        _, created = self.thread(owner["token"], board)
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "contribute", owner["user_id"])
        self.client.replies = [OK_JSON]
        self.post("/api/forum/posts", {"thread_id": created["thread_id"], "body": "mine too"},
                  token=guest["token"])
        _, view = self.get(f"/api/forum/thread?thread_id={created['thread_id']}",
                           token=owner["token"])
        self.assertEqual(["there is something walking on my roof every night", "mine too"],
                         [p["body"] for p in view["posts"]])
        self.assertEqual(["owner", "guest"], [p["handle"] for p in view["posts"]])

    def test_a_viewer_reads_but_does_not_post(self):
        owner, board = self.board()
        _, created = self.thread(owner["token"], board)
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "view", owner["user_id"])
        read, _ = self.get(f"/api/forum?storyboard_id={board}", token=guest["token"])
        self.assertEqual(200, read)
        self.client.replies = [OK_JSON]
        status, payload = self.post("/api/forum/posts",
                                    {"thread_id": created["thread_id"], "body": "let me in"},
                                    token=guest["token"])
        self.assertEqual(403, status)
        self.assertEqual("read_only_access", payload["error"]["code"])

    def test_a_stranger_sees_nothing(self):
        owner, board = self.board()
        self.thread(owner["token"], board)
        stranger = self.session("stranger")
        status, payload = self.get(f"/api/forum?storyboard_id={board}", token=stranger["token"])
        self.assertEqual(403, status)
        self.assertEqual("no_access", payload["error"]["code"])

    def test_the_assistant_never_sees_forum_content(self):
        owner, board = self.board()
        self.thread(owner["token"], board, body="SOMETHING ONLY SAID IN THE FORUM")
        self.client.calls.clear()
        self.client.replies = []
        self.post("/api/assistant", {"role": "neighbour", "storyboard_id": board,
                                     "message": "what have I been saying?"}, token=owner["token"])
        sent = json.dumps(self.client.calls[-1], ensure_ascii=False)
        self.assertNotIn("SOMETHING ONLY SAID IN THE FORUM", sent)

    def test_a_closed_storyboard_takes_no_new_threads(self):
        owner, board = self.board()
        self.db.conn.execute("UPDATE storyboards SET status = 'archived' WHERE id = ?", (board,))
        status, payload = self.thread(owner["token"], board)
        self.assertEqual(409, status)
        self.assertEqual("storyboard_closed", payload["error"]["code"])

    def test_an_unknown_thread_is_gone(self):
        who = self.session()
        status, payload = self.get("/api/forum/thread?thread_id=nope", token=who["token"])
        self.assertEqual(404, status)
        self.assertEqual("gone", payload["error"]["code"])

    def test_reading_a_thread_carries_its_title(self):
        owner, board = self.board("owner")
        self.client.replies = [OK_JSON]
        _, made = self.post("/api/forum/threads",
                            {"storyboard_id": board, "title": "That clicking noise",
                             "body": "Never heard it before."}, token=owner["token"])
        status, view = self.get(f"/api/forum/thread?thread_id={made['thread_id']}",
                                token=owner["token"])
        self.assertEqual(200, status)
        self.assertEqual("That clicking noise", view["title"])
        self.assertEqual(1, len(view["posts"]))


class Review(Fixture):
    """operations §2: who can see it, how to vote, two votes deciding, seven days
    clearing it, and the owner having the last word.
    """

    def flagged(self):
        """One entry marked review, plus a neighbour entitled to vote."""
        owner, board = self.board("owner")
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "contribute", owner["user_id"])
        _, created = self.submit(owner["token"], board, REVIEW_JSON,
                                 fun_fact="Ringtails live about 40 years.", story=None)
        return owner, guest, board, created["entry_id"]

    def queue(self, token, board):
        return self.get(f"/api/review?storyboard_id={board}", token=token)

    def vote(self, token, entry_id, choice):
        return self.post("/api/review/vote", {"entry_id": entry_id, "vote": choice}, token=token)

    def test_other_contributors_see_it_and_the_author_does_not(self):
        owner, guest, board, entry_id = self.flagged()
        status, theirs = self.queue(guest["token"], board)
        self.assertEqual(200, status)
        self.assertEqual([entry_id], [i["entry_id"] for i in theirs["items"]])
        _, mine = self.queue(owner["token"], board)
        self.assertEqual([], mine["items"])

    def test_the_author_cannot_vote_on_their_own(self):
        owner, _, _, entry_id = self.flagged()
        status, payload = self.vote(owner["token"], entry_id, "looks_right")
        self.assertEqual(403, status)
        self.assertEqual("not_your_call", payload["error"]["code"])

    def test_a_viewer_is_not_part_of_this(self):
        owner, _, board, entry_id = self.flagged()
        watcher = self.session("watcher")
        self.db.grant(board, watcher["user_id"], "view", owner["user_id"])
        self.assertEqual(403, self.queue(watcher["token"], board)[0])
        self.assertEqual(403, self.vote(watcher["token"], entry_id, "worth_checking")[0])

    def test_two_worth_checking_apply_the_public_label(self):
        owner, guest, board, entry_id = self.flagged()
        second = self.session("second")
        self.db.grant(board, second["user_id"], "contribute", owner["user_id"])
        self.vote(guest["token"], entry_id, "worth_checking")
        self.vote(second["token"], entry_id, "worth_checking")
        _, view = self.get(f"/api/timeline?storyboard_id={board}", token=owner["token"])
        self.assertEqual(1, view["entries"][0]["being_checked"])
        self.assertEqual([], self.queue(guest["token"], board)[1]["items"])

    def test_two_looks_right_clear_it_without_a_label(self):
        owner, guest, board, entry_id = self.flagged()
        second = self.session("second")
        self.db.grant(board, second["user_id"], "contribute", owner["user_id"])
        self.vote(guest["token"], entry_id, "looks_right")
        self.vote(second["token"], entry_id, "looks_right")
        _, view = self.get(f"/api/timeline?storyboard_id={board}", token=owner["token"])
        self.assertEqual(0, view["entries"][0]["being_checked"])
        self.assertEqual([], self.queue(guest["token"], board)[1]["items"])

    def test_one_person_is_one_vote_even_after_changing_their_mind(self):
        owner, guest, board, entry_id = self.flagged()
        self.vote(guest["token"], entry_id, "worth_checking")
        _, tally = self.vote(guest["token"], entry_id, "looks_right")
        self.assertEqual(0, tally["worth_checking"])
        self.assertEqual(1, tally["looks_right"])
        self.assertEqual([entry_id], [i["entry_id"] for i in self.queue(guest["token"], board)[1]["items"]])

    def test_nobody_learns_who_voted(self):
        owner, guest, board, entry_id = self.flagged()
        _, tally = self.vote(guest["token"], entry_id, "worth_checking")
        _, listing = self.queue(guest["token"], board)
        blob = json.dumps([tally, listing], ensure_ascii=False)
        self.assertNotIn(guest["user_id"], blob)
        self.assertNotIn("guest", blob)

    def test_the_owner_can_remove_it_and_that_is_a_soft_delete(self):
        owner, _, board, entry_id = self.flagged()
        status, payload = self.post("/api/review/dispose",
                                    {"entry_id": entry_id, "action": "removed"},
                                    token=owner["token"])
        self.assertEqual(200, status)
        self.assertEqual("removed", payload["disposition"])
        _, view = self.get(f"/api/timeline?storyboard_id={board}", token=owner["token"])
        self.assertEqual([], view["entries"])
        self.assertIsNotNone(self.db.entry(entry_id)["deleted_at"])   # still there, only soft-deleted

    def test_only_the_owner_disposes(self):
        _, guest, _, entry_id = self.flagged()
        status, payload = self.post("/api/review/dispose",
                                    {"entry_id": entry_id, "action": "kept"},
                                    token=guest["token"])
        self.assertEqual(403, status)
        self.assertEqual("not_the_owner", payload["error"]["code"])

    def test_a_flag_nobody_touched_clears_itself_after_seven_days(self):
        owner, guest, board, entry_id = self.flagged()
        stale = (datetime.now(timezone.utc) - timedelta(days=8)).isoformat(timespec="seconds")
        self.db.conn.execute("UPDATE screening_results SET created_at = ? WHERE subject_id = ?",
                             (stale, entry_id))
        self.db.conn.commit()
        self.assertEqual([], self.queue(guest["token"], board)[1]["items"])
        _, view = self.get(f"/api/timeline?storyboard_id={board}", token=owner["token"])
        self.assertEqual(0, view["entries"][0]["being_checked"])

    def test_the_queue_carries_no_author_identity_at_all(self):
        """The author is never told (operations §2.3) because the query does not carry
        it, not because the interface hides it.

        An interface can only leak what reached it. This pins down that the data never came.
        """
        owner, guest, board, entry_id = self.flagged()
        status, queue = self.queue(guest["token"], board)
        self.assertEqual(200, status)
        self.assertEqual(1, len(queue["items"]))
        raw = json.dumps(queue, ensure_ascii=False)
        self.assertNotIn(owner["handle"], raw)
        self.assertNotIn(owner["user_id"], raw)
        for field in ("handle", "author_id", "author", "voter_id"):
            self.assertNotIn(field, queue["items"][0], f"{field} appeared in the queue")

    def test_the_tally_is_counts_only_never_who_voted(self):
        owner, guest, board, entry_id = self.flagged()
        self.vote(guest["token"], entry_id, "worth_checking")
        status, payload = self.vote(guest["token"], entry_id, "looks_right")
        self.assertEqual(200, status)
        self.assertEqual({"entry_id", "worth_checking", "looks_right"}, set(payload))
        self.assertNotIn(guest["user_id"], json.dumps(payload))

    def test_reading_the_queue_clears_out_records_past_their_thirty_days(self):
        """The retention-table line about deleting 30 days after disposal had never
        once happened.

        purge_screening() was written and tested, but nothing called it. It is lazy now,
        like settle_stale and settle_review: whoever touches the table clears it, no cron.
        """
        owner, guest, board, entry_id = self.flagged()
        self.post("/api/review/dispose", {"entry_id": entry_id, "action": "kept"},
                  token=owner["token"])
        self.assertEqual(1, len(self.rows()))
        old = (datetime.now(timezone.utc) - timedelta(days=40)).isoformat(timespec="seconds")
        self.db.conn.execute("UPDATE screening_results SET disposed_at = ? WHERE subject_id = ?",
                             (old, entry_id))
        self.db.conn.commit()
        self.queue(guest["token"], board)
        self.assertEqual([], self.rows())

    def test_the_ones_still_waiting_are_left_alone(self):
        """Clearing too eagerly empties the queue while people are still working on it."""
        owner, guest, board, entry_id = self.flagged()
        self.queue(guest["token"], board)
        self.assertEqual(1, len(self.rows()))
        self.assertEqual([entry_id], [i["entry_id"] for i in
                                      self.queue(guest["token"], board)[1]["items"]])

    def test_a_stranger_cannot_drive_the_purge(self):
        """The clean-up is a DELETE, and sign-up is open in production — holding a
        valid token is the same thing as being anybody on the internet.

        So it sits after the permission gate, unlike the other two settlers, which sit first.
        """
        owner, guest, board, entry_id = self.flagged()
        self.post("/api/review/dispose", {"entry_id": entry_id, "action": "kept"},
                  token=owner["token"])
        old = (datetime.now(timezone.utc) - timedelta(days=40)).isoformat(timespec="seconds")
        self.db.conn.execute("UPDATE screening_results SET disposed_at = ? WHERE subject_id = ?",
                             (old, entry_id))
        self.db.conn.commit()
        stranger = self.session("stranger")
        status, payload = self.queue(stranger["token"], board)
        self.assertEqual(403, status)
        self.assertEqual("no_access", payload["error"]["code"])
        self.assertEqual(1, len(self.rows()), "a refused caller drove a table-wide delete")


class Grants(Fixture):
    """GET /api/grants — the share screen needs who has access and at what level."""

    def test_the_owner_sees_themselves_and_everyone_they_let_in(self):
        owner, board = self.board("owner")
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "contribute", owner["user_id"])
        status, payload = self.get(f"/api/grants?storyboard_id={board}", token=owner["token"])
        self.assertEqual(200, status)
        self.assertEqual(owner["user_id"], payload["owner_id"])
        self.assertEqual({("owner", "reshare"), ("guest", "contribute")},
                         {(g["handle"], g["level"]) for g in payload["grants"]})

    def test_a_revoked_grant_leaves_the_list(self):
        owner, board = self.board("owner")
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "contribute", owner["user_id"])
        self.post("/api/grants/revoke", {"storyboard_id": board, "user_id": guest["user_id"]},
                  token=owner["token"])
        _, payload = self.get(f"/api/grants?storyboard_id={board}", token=owner["token"])
        self.assertEqual(["owner"], [g["handle"] for g in payload["grants"]])

    def test_a_read_only_viewer_cannot_see_the_list(self):
        owner, board = self.board("owner")
        watcher = self.session("watcher")
        self.db.grant(board, watcher["user_id"], "view", owner["user_id"])
        status, payload = self.get(f"/api/grants?storyboard_id={board}", token=watcher["token"])
        self.assertEqual(403, status)
        self.assertEqual("cannot_share", payload["error"]["code"])

    def test_a_stranger_gets_nothing(self):
        _, board = self.board("owner")
        stranger = self.session("stranger")
        status, _ = self.get(f"/api/grants?storyboard_id={board}", token=stranger["token"])
        self.assertEqual(403, status)

    def test_the_list_carries_the_user_id_revoking_needs(self):
        owner, board = self.board("owner")
        _, payload = self.get(f"/api/grants?storyboard_id={board}", token=owner["token"])
        target = payload["grants"][0]
        # Revoke straight from the user_id in the list, with no second lookup
        self.assertEqual(owner["user_id"], target["user_id"])


if __name__ == "__main__":
    unittest.main()
