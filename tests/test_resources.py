"""Resource endpoints: issuing a token, creating a storyboard. Real HTTP, because the
path dispatch is itself part of what is being checked.

Vercel has one entrypoint, every path lands in the same handler, and the routing is ours.

    python tests/test_resources.py
"""

import json
import os
import re
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
from unittest import mock                                          # noqa: E402
from proxy import auth                                             # noqa: E402
from proxy.ports import CEILINGS, DEFAULT_LIMITS                   # noqa: E402
from proxy.app import (COPY, FUN_FACT_LIMIT, SHARE_LINK_DAYS,      # noqa: E402
                       STILL_LIMIT, STORY_LIMIT, TIMELINE_PAGE, Deps)
from proxy.db import (PARTICIPANT_LIMIT, Database, SqliteCeilings,  # noqa: E402
                      SqliteContext, SqliteHistory, SqliteScreeningLog)

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
        # system and history are recorded because that is where the context block and
        # the earlier turns ride — "what the assistant sees" means the whole request.
        self.calls.append({"role": role, "system": system, "content": content,
                           "history": list(history)})
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
        """A storyboard and its owner, made straight in the database.

        Through the endpoint until #36, which sends the title to the Screener. Scaffolding
        for a test about something else should not spend model calls or leave an audit row
        in front of the one the test came to read — every count of screening_results and of
        client.calls would have had to know that a storyboard had been made first. The
        endpoint has its own tests, in Storyboards.
        """
        who = self.session(handle)
        return who, self.db.add_storyboard(who["user_id"], "Fence at number 12")

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

    def test_a_non_string_handle_is_a_bad_request_not_a_crash(self):
        """create_session strips the handle directly; a list or dict raised AttributeError
        and came back a 500. A non-string handle is a malformed request, so 400."""
        status, payload = self.post("/api/session", {"handle": ["neighbour-a"]})
        self.assertEqual(400, status)
        self.assertEqual("bad_request", payload["error"]["code"])

    def test_an_empty_title_storyboard_is_still_metered(self):
        """A titleless board skipped the Screener and so skipped its quota charge, letting a
        token mint storyboards without limit. It is charged the submission ceiling now."""
        token = self.session()["token"]
        with mock.patch.dict("proxy.ports.DEFAULT_LIMITS", {"submission": (1, 3600)}):
            first, _ = self.post("/api/storyboards", {}, token=token)
            self.assertEqual(200, first)
            status, payload = self.post("/api/storyboards", {}, token=token)
        self.assertEqual(429, status, "a second empty-title board was created for free")
        self.assertEqual("rate_limited", payload["error"]["code"])

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
        self.assertEqual([], self.db.timeline(board, TIMELINE_PAGE))
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


class TimelinePaging(Fixture):
    """/api/timeline is bounded, and the bound is arithmetic rather than taste.

    Until 2026-09-17 it returned every entry on a storyboard, each with a base64 frame in
    `still`. Measured on this schema that is 25.4 kB an entry at the size the mask screen
    produces and 117.6 kB at STILL_LIMIT, against a 4.5 MB platform cap on a function's
    response body — so the endpoint had a cliff at roughly 181 ordinary entries, or 39 from a
    client sending frames at the ceiling, and past it the answer is not a slow page but a 413.
    Every test in this file passed throughout, because no storyboard in the suite has twenty
    entries in it. That is the shape of green that ships a defect.

    The paging is keyset, not LIMIT/OFFSET, and these check the property that buys: pages
    taken while the storyboard is being written to still add up to the list.
    """

    def storyboard_of(self, count, handle="owner"):
        """`count` entries by one author, inserted directly. Going through /api/entries would
        mean a screener round trip each, and what is under test is the reading."""
        who, board = self.board(handle)
        ids = [self.db.add_entry(board, who["user_id"], "ringtail", story=f"sighting {i}",
                                 still="A" * 40) for i in range(count)]
        return who, board, ids

    def page(self, token, board, after=None):
        query = f"/api/timeline?storyboard_id={board}"
        if after:
            query += f"&after={after}"
        status, payload = self.get(query, token=token)
        self.assertEqual(200, status, payload)
        return payload

    def walk(self, token, board):
        """Every page, followed to the end. Returns the ids in the order they arrived."""
        seen, cursor, pages = [], None, 0
        while True:
            payload = self.page(token, board, cursor)
            seen += [e["id"] for e in payload["entries"]]
            cursor, pages = payload["next"], pages + 1
            self.assertLess(pages, 20, "the cursor never finished")
            if cursor is None:
                return seen

    def test_a_short_storyboard_fits_in_one_page_and_says_so(self):
        who, board, ids = self.storyboard_of(3)
        payload = self.page(who["token"], board)
        self.assertEqual(ids, [e["id"] for e in payload["entries"]])
        self.assertIsNone(payload["next"], "a finished list still offered another page")

    def test_a_page_is_never_longer_than_the_page_size(self):
        who, board, _ = self.storyboard_of(TIMELINE_PAGE + 7)
        self.assertEqual(TIMELINE_PAGE, len(self.page(who["token"], board)["entries"]))

    def test_the_pages_add_up_to_the_whole_list_in_order(self):
        """The one that matters. Inserted in a burst, so every entry shares a created_at to
        the second and the rowid half of the cursor is carrying the whole ordering."""
        who, board, ids = self.storyboard_of(TIMELINE_PAGE * 2 + 3)
        walked = self.walk(who["token"], board)
        self.assertEqual(ids, walked)
        self.assertEqual(len(set(walked)), len(walked), "an entry came back on two pages")

    def test_the_pages_add_up_when_the_stamps_differ_too(self):
        """The other branch of the cursor. A burst exercises `created_at = ? AND rowid > ?`
        and never the plain `created_at > ?`, so a comparison broken there would pass every
        other test in this class."""
        who, board, ids = self.storyboard_of(TIMELINE_PAGE + 5)
        for minute, entry in enumerate(ids):
            self.db.conn.execute("UPDATE entries SET created_at = ? WHERE id = ?",
                                 (f"2026-09-01T09:{minute:02d}:00+00:00", entry))
        self.db.conn.commit()
        self.assertEqual(ids, self.walk(who["token"], board))

    def test_an_entry_posted_between_two_pages_does_not_shift_the_window(self):
        """Why the cursor is a position and not an offset. With OFFSET, a row arriving before
        the window moves everything down one and the reader is handed the entry they just
        read again — or, on a delete, skips one entirely and never knows."""
        who, board, ids = self.storyboard_of(TIMELINE_PAGE + 4)
        first = self.page(who["token"], board)
        self.db.add_entry(board, who["user_id"], "brushtail", story="posted mid-scroll")
        rest = self.page(who["token"], board, first["next"])["entries"]
        self.assertEqual(ids[:TIMELINE_PAGE], [e["id"] for e in first["entries"]])
        self.assertEqual(ids[TIMELINE_PAGE:], [e["id"] for e in rest][:4],
                         "the second page repeated or skipped a sighting")

    def test_a_cursor_survives_its_own_entry_being_deleted(self):
        """The cursor entry is a coordinate, not content. Somebody deleting their sighting
        while a neighbour is part-way down the list must not strand that neighbour, so
        entry_position deliberately does not filter deleted_at."""
        who, board, ids = self.storyboard_of(TIMELINE_PAGE + 4)
        cursor = self.page(who["token"], board)["next"]
        self.post("/api/entries/delete", {"entry_id": cursor}, token=who["token"])
        rest = self.page(who["token"], board, cursor)["entries"]
        self.assertEqual(ids[TIMELINE_PAGE:], [e["id"] for e in rest],
                         "deleting the cursor entry lost the rest of the list")

    def test_a_cursor_this_storyboard_never_issued_is_refused(self):
        """Not a silent restart at the top. A cursor the server does not recognise means the
        two of them disagree about where they are, and answering page one to a request for
        page three looks exactly like the rest of the list having been deleted."""
        who, board, _ = self.storyboard_of(2)
        _, _, other = self.storyboard_of(2, handle="neighbour-b")
        for bad in ("no-such-entry", other[0]):
            with self.subTest(cursor=bad[:12]):
                status, payload = self.get(
                    f"/api/timeline?storyboard_id={board}&after={bad}", token=who["token"])
                self.assertEqual(400, status)
                self.assertEqual("bad_request", payload["error"]["code"])

    def test_a_cursor_is_not_an_existence_oracle_without_a_grant(self):
        """The grant is checked before the cursor. Otherwise the difference between 400 and
        403 would answer "does this entry id exist on that storyboard" for somebody who
        cannot read a word of it."""
        _, board, ids = self.storyboard_of(2)
        stranger = self.session("stranger")
        for cursor in (ids[0], "no-such-entry"):
            with self.subTest(cursor=cursor[:12]):
                status, payload = self.get(
                    f"/api/timeline?storyboard_id={board}&after={cursor}",
                    token=stranger["token"])
                self.assertEqual(403, status)
                self.assertEqual("no_access", payload["error"]["code"])

    def test_the_header_counts_the_storyboard_and_not_the_page(self):
        """The detail screen says how many sightings there are, who has contributed and what
        date the storyboard runs from. It used to count the entry list it was handed, so
        bounding that list without these three fields would have turned all of them into
        "how many have loaded so far" — three confident numbers, all wrong, which is worse
        than the slow page it fixed."""
        who, board, ids = self.storyboard_of(TIMELINE_PAGE + 5)
        payload = self.page(who["token"], board)
        self.assertEqual(TIMELINE_PAGE, len(payload["entries"]))
        self.assertEqual(len(ids), payload["sightings"])
        self.assertEqual(["owner"], payload["participants"])

    def test_the_header_lists_every_contributor_in_the_order_they_arrived(self):
        """First-appearance order, not alphabetical: that is the order the screen showed when
        it was deduplicating handles itself, and this query replaced that."""
        who, board, _ = self.storyboard_of(2)
        second = self.session("neighbour-b")
        self.db.grant(board, second["user_id"], "contribute", who["user_id"])
        self.db.add_entry(board, second["user_id"], "ringtail", story="mine too")
        self.db.add_entry(board, who["user_id"], "ringtail", story="and another")
        self.assertEqual(["owner", "neighbour-b"],
                         self.page(who["token"], board)["participants"])

    def test_the_header_ignores_deleted_sightings(self):
        """A soft delete is immediate everywhere, which has to include the count. A header
        reading one more than the list is a reader looking for a sighting nobody removed."""
        who, board, ids = self.storyboard_of(3)
        self.post("/api/entries/delete", {"entry_id": ids[0]}, token=who["token"])
        payload = self.page(who["token"], board)
        self.assertEqual(2, payload["sightings"])
        self.assertEqual(ids[1], payload["entries"][0]["id"])
        self.assertEqual(payload["entries"][0]["created_at"], payload["first_seen"],
                         "first_seen still pointed at the deleted sighting")

    def test_the_timeline_count_and_the_dashboard_count_agree(self):
        """Two endpoints now report the same number from the same predicate, and two counts
        that must agree are a thing that drifts. /api/dashboard has computed entry_count since
        it existed, to save the list screen pulling a whole timeline per storyboard;
        /api/timeline gained `sightings` so a page of twenty could state the whole. Both read
        entries WHERE storyboard_id = ? AND deleted_at IS NULL, and this is what says so.
        """
        who, board, ids = self.storyboard_of(TIMELINE_PAGE + 5)
        self.post("/api/entries/delete", {"entry_id": ids[0]}, token=who["token"])
        _, home = self.get("/api/dashboard", token=who["token"])
        row = [b for b in home["active"] if b["id"] == board][0]
        self.assertEqual(TIMELINE_PAGE + 4, row["entry_count"])
        self.assertEqual(row["entry_count"], self.page(who["token"], board)["sightings"],
                         "the header and the list card would show different totals")

    def test_the_page_size_cannot_outgrow_the_platform_cap(self):
        """The two constants are in a relationship, so a change to either has to be
        deliberate. Vercel answers 413 FUNCTION_PAYLOAD_TOO_LARGE over 4.5 MB on a response
        body, and the worst case one page can produce is every row at STILL_LIMIT."""
        worst_case = TIMELINE_PAGE * STILL_LIMIT
        self.assertLess(worst_case, 4.5 * 1024 * 1024 * 0.75,
                        "a full page of frames at the cap leaves no room for the rest of "
                        "the response; lower TIMELINE_PAGE or STILL_LIMIT")

    def test_the_worst_page_anybody_can_build_is_measured_under_the_cap(self):
        """Measured, not multiplied. The arithmetic test beside this one counts characters,
        and characters are bytes only for ASCII - which is how a page of emoji stills got past
        it. Every field here is at its limit and every free-text character is outside the
        Basic Multilingual Plane, the most json.dumps can inflate one: stills at STILL_LIMIT
        of base64, stories and fun facts at their caps in emoji. The body the server actually
        sends has to fit."""
        who, board = self.board()
        still = ("A" * (STILL_LIMIT - 2)) + "=="
        wide = "\U0001F994"
        for _ in range(TIMELINE_PAGE):
            self.db.add_entry(board, who["user_id"], "ringtail", fun_fact=wide * FUN_FACT_LIMIT,
                              story=wide * STORY_LIMIT, still=still)
        request = urllib.request.Request(f"{self.base}/api/timeline?storyboard_id={board}",
                                         headers={"authorization": "Bearer " + who["token"]})
        body = urllib.request.urlopen(request).read()
        self.assertEqual(TIMELINE_PAGE, len(json.loads(body)["entries"]))
        self.assertLess(len(body), 4.5 * 1024 * 1024,
                        f"the worst page is {len(body):,} bytes, over the platform cap")

    def test_the_contributor_list_is_capped_and_the_rest_are_counted(self):
        """The participants list was not paged. 5,001 guests with 24-emoji handles took one
        page past the cap in the pre-deploy recheck. Named up to PARTICIPANT_LIMIT, counted
        in full."""
        who, board = self.board()
        extra = PARTICIPANT_LIMIT + 10
        for i in range(extra):
            author = self.db.add_user(f"{i:04d}" + "\U0001F994" * 20)
            self.db.add_entry(board, author, "ringtail", story="one each")
        payload = self.page(who["token"], board)
        self.assertEqual(PARTICIPANT_LIMIT, len(payload["participants"]))
        self.assertEqual(extra, payload["contributors"])

    def test_a_still_stored_before_the_base64_rule_is_not_sent(self):
        """The rule on writes cannot reach stills the deployed API already took. The pre-deploy
        recheck pointed out a page of those would still be 5.76 MB, so it applies on read."""
        who, board = self.board()
        self.db.add_entry(board, who["user_id"], "ringtail", story="old", still="\U0001F994" * 50)
        self.db.add_entry(board, who["user_id"], "ringtail", story="good", still="QUJD")
        stills = {e["story"]: e["still"] for e in self.page(who["token"], board)["entries"]}
        self.assertEqual({"old": None, "good": "QUJD"}, stills)

    def test_the_offline_pager_uses_the_same_page_size(self):
        """fixtures.js pages the offline timeline the way the server does, and like the share
        default it holds its own copy of the number. Read out of the source, the way the
        schema test reads the document, so the two cannot part quietly."""
        source = (ROOT / "web" / "lib" / "fixtures.js").read_text(encoding="utf-8")
        found = re.findall(r"^const PAGE = (\d+);", source, re.M)
        self.assertEqual([str(TIMELINE_PAGE)], found)

    def test_an_empty_storyboard_answers_with_an_empty_list(self):
        """Not an error and not a missing key. Nought sightings is the state every storyboard
        starts in, and the screen has copy for it."""
        who, board = self.board()
        payload = self.page(who["token"], board)
        self.assertEqual([], payload["entries"])
        self.assertIsNone(payload["next"])
        self.assertEqual(0, payload["sightings"])
        self.assertEqual([], payload["participants"])
        self.assertIsNone(payload["first_seen"])


class TheMaskedFrameOnAnEntry(Fixture):
    """An entry carries the frame its author masked, so a storyboard shows the street's own
    footage rather than a stock photograph. data-model.md §1 entries.still.

    The still is the masked one by construction: the interface redacts before it submits,
    and the boxes are burned into the pixels rather than recorded alongside them.
    """

    JPEG = "/9j/4AAQSkZJRgABAQ" + "A" * 200        # shaped like base64, not a real image

    def entry(self, **over):
        owner, board = self.board("owner")
        body = {"storyboard_id": board, "species": "brushtail", "story": "along the fence"}
        body.update(over)
        status, made = self.post("/api/entries", body, token=owner["token"])
        return owner, board, status, made

    def test_the_frame_comes_back_on_the_timeline(self):
        owner, board, status, made = self.entry(still=self.JPEG)
        self.assertEqual(200, status)
        _, view = self.get(f"/api/timeline?storyboard_id={board}", token=owner["token"])
        mine = [e for e in view["entries"] if e["id"] == made["entry_id"]][0]
        self.assertEqual(self.JPEG, mine["still"])

    def test_a_frame_carrying_exif_is_dropped_but_the_sighting_posts(self):
        """The client strips EXIF by re-encoding through a canvas, but a caller bypassing it
        could POST a raw phone JPEG with a GPS tag. A frame with a metadata block is dropped
        server-side and the account of the evening still posts. Built from bytes so the
        base64 is real and decodes: SOI, an APP1 (EXIF) segment, EOI."""
        import base64
        seg = b"\xff\xe1" + (2 + 6).to_bytes(2, "big") + b"Exif\x00\x00"
        exif = base64.b64encode(b"\xff\xd8" + seg + b"\xff\xd9").decode()
        owner, board, status, made = self.entry(still=exif, story="it came back")
        self.assertEqual(200, status)
        self.assertTrue(made["published"])
        _, view = self.get(f"/api/timeline?storyboard_id={board}", token=owner["token"])
        mine = [e for e in view["entries"] if e["id"] == made["entry_id"]][0]
        self.assertIsNone(mine["still"], "an EXIF-bearing frame reached the timeline")
        row = self.db.conn.execute("SELECT still FROM entries WHERE id = ?",
                                   (made["entry_id"],)).fetchone()
        self.assertIsNone(row["still"], "an EXIF-bearing frame was stored")

    def test_a_metadata_free_frame_round_trips(self):
        """The check is narrow: only a real metadata block is refused. An APP0/JFIF segment
        is not metadata, so a clean JPEG that decodes is kept whole."""
        import base64
        payload = b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
        seg = b"\xff\xe0" + (2 + len(payload)).to_bytes(2, "big") + payload
        clean = base64.b64encode(b"\xff\xd8" + seg + b"\xff\xd9").decode()
        owner, board, status, made = self.entry(still=clean)
        self.assertEqual(200, status)
        _, view = self.get(f"/api/timeline?storyboard_id={board}", token=owner["token"])
        mine = [e for e in view["entries"] if e["id"] == made["entry_id"]][0]
        self.assertEqual(clean, mine["still"], "a clean frame was dropped")

    def test_an_entry_without_one_is_ordinary(self):
        # The placeholder path, and any browser that could not decode the clip.
        owner, board, status, made = self.entry()
        self.assertEqual(200, status)
        _, view = self.get(f"/api/timeline?storyboard_id={board}", token=owner["token"])
        mine = [e for e in view["entries"] if e["id"] == made["entry_id"]][0]
        self.assertIsNone(mine["still"])

    def test_a_bad_still_costs_the_picture_and_not_the_sighting(self):
        """Somebody's account of their own evening does not get refused because the image
        beside it was the wrong shape. The client sends about 25 kB; anything over the cap
        is a fault in the client, not a reason to lose what they wrote."""
        # The last two are the pre-deploy review's. A still of emoji passed the length check
        # and json.dumps escaped each character to twelve bytes, so four of them took one
        # timeline page past the platform's 4.5 MB cap.
        #
        # The row is read as well as the timeline. The timeline filters bad stills on the way
        # out too, so on its own it could not see the check on the way in stop working: taking
        # that check out passed this test until the row was asked. Found by re-running the
        # mutations against the finished tree before it was squashed.
        for bad in ("x" * (STILL_LIMIT + 1), 12345, ["not", "a", "string"], "", None,
                    "\U0001F994" * 1000, "not base64 at all!"):
            with self.subTest(kind=type(bad).__name__):
                owner, board, status, made = self.entry(still=bad, story="it came back")
                self.assertEqual(200, status, "a bad still refused the whole sighting")
                self.assertTrue(made["published"])
                _, view = self.get(f"/api/timeline?storyboard_id={board}", token=owner["token"])
                mine = [e for e in view["entries"] if e["id"] == made["entry_id"]][0]
                self.assertIsNone(mine["still"])
                self.assertEqual("it came back", mine["story"])
                row = self.db.conn.execute("SELECT still FROM entries WHERE id = ?",
                                           (made["entry_id"],)).fetchone()
                self.assertIsNone(row["still"], "a bad still was stored, only hidden on read")

    def test_deleting_the_entry_takes_the_frame_with_it(self):
        owner, board, _, made = self.entry(still=self.JPEG)
        self.post("/api/entries/delete", {"entry_id": made["entry_id"]}, token=owner["token"])
        _, view = self.get(f"/api/timeline?storyboard_id={board}", token=owner["token"])
        self.assertEqual([], [e for e in view["entries"] if e["id"] == made["entry_id"]])


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

    def test_bidi_and_zero_width_format_characters_are_refused(self):
        """Higher than the control-char check reaches: a bidi override (Trojan-Source
        display spoofing), a bidi isolate, the zero-width space, the BOM and a C1 control.
        Each would let stored text render differently from the bytes screened and held, or
        hide PII from a reader and a literal match. Built with chr(), never as literals,
        which the repo's own invisible-character scrub would strip out of this file."""
        # Embedded mid-string, not trailing: a C1 like U+0085 is Unicode whitespace that
        # .strip() would remove from an end anyway, so the attack that matters is one buried
        # between real words, where it survives to render and to store.
        for cp in (0x202E, 0x2066, 0x200B, 0xFEFF, 0x85):
            status, _ = self.submit(story="on the" + chr(cp) + "fence")
            self.assertEqual(400, status, f"U+{cp:04X} got through")

    def test_non_english_and_joined_text_still_passes(self):
        """The denylist is narrow on purpose. Correct right-to-left, CJK and joined text has
        to pass because non-English submissions are never rejected: ZWNJ/ZWJ and the LRM/RLM
        marks are load-bearing in Arabic, Persian and Indic scripts and in emoji, so they
        stay allowed. Everything invisible here is built with chr() to keep this source
        ASCII and out of reach of the scrub."""
        arabic = "".join(chr(c) for c in (0x645, 0x631, 0x62D, 0x628, 0x627))
        chinese = "".join(chr(c) for c in (0x4F60, 0x597D, 0x4E16, 0x754C))
        for good in (arabic, chinese, "man" + chr(0x200D) + "woman", "a" + chr(0x200E) + "b"):
            status, out = self.submit(story="saw one " + good)
            self.assertEqual(200, status, f"legitimate text refused: {good!r}")
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

    def test_a_revoked_author_cannot_edit_but_can_still_withdraw(self):
        """Revoking someone's grant removes their write access at once. Their token stays
        valid (revoke marks access_grants, not the token), so editing an old entry would
        otherwise keep broadcasting new content onto a board they were removed from. Editing
        needs a current write grant like submitting; deleting does not — withdrawing your own
        words survives revocation on purpose."""
        owner, board = self.board()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "contribute", owner["user_id"])
        _, created = self.submit(guest["token"], board, OK_JSON, story="mine, on the fence")
        entry_id = created["entry_id"]
        self.db.revoke(board, guest["user_id"])

        status, payload = self.post("/api/entries/edit",
                                    {"entry_id": entry_id, "story": "call me on 0400 000 000"},
                                    token=guest["token"])
        self.assertEqual(403, status)
        self.assertEqual("no_access", payload["error"]["code"])
        self.assertEqual("mine, on the fence", self.db.entry(entry_id)["story"],
                         "a revoked author's edit still changed the board")

        status, payload = self.post("/api/entries/delete", {"entry_id": entry_id},
                                    token=guest["token"])
        self.assertEqual(200, status, "a revoked author could not withdraw their own entry")
        self.assertTrue(payload["deleted"])

    def test_an_author_downgraded_to_view_cannot_edit(self):
        """The same gate catches a contributor downgraded to view: no write level, no edit."""
        owner, board = self.board()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "contribute", owner["user_id"])
        _, created = self.submit(guest["token"], board, OK_JSON, story="mine, on the fence")
        entry_id = created["entry_id"]
        self.db.grant(board, guest["user_id"], "view", owner["user_id"])

        status, payload = self.post("/api/entries/edit",
                                    {"entry_id": entry_id, "story": "later"},
                                    token=guest["token"])
        self.assertEqual(403, status)
        self.assertEqual("read_only_access", payload["error"]["code"])


class Sharing(Fixture):
    """A QR link carrying an access level: issue, redeem, revoke."""

    def link(self, token, storyboard_id, **over):
        body = {"storyboard_id": storyboard_id}
        body.update(over)
        return self.post("/api/share-links", body, token=token)

    def links(self, token, storyboard_id):
        return self.get(f"/api/share-links?storyboard_id={storyboard_id}", token=token)

    def test_a_code_with_no_stated_life_lasts_the_default(self):
        """Seven days, per the note above SHARE_LINK_DAYS. Checked against the stamp the
        server writes rather than the constant, so a default that stopped reaching the
        stored row would fail here even with the constant untouched."""
        owner, board = self.board()
        before = datetime.now(timezone.utc)
        status, issued = self.link(owner["token"], board)
        self.assertEqual(200, status)
        life = datetime.fromisoformat(issued["expires_at"]) - before
        self.assertAlmostEqual(SHARE_LINK_DAYS * 86400, life.total_seconds(), delta=5)

    def test_the_share_screen_opens_on_the_same_default_as_the_server(self):
        """Two languages, so two places, and nothing else holds them together.

        Until 2026-09-18 the server read an undocumented SHARE_LINK_DAYS variable and the share
        screen started on a literal 7 of its own. The screen always sends expires_in_days, so
        the variable never reached a real request: set to 14 on the deployment, it would have
        changed nothing a person sees, and nobody would have been told. This reads the client
        constant out of the source the way the schema test reads the document, and fails the
        moment the two part.
        """
        source = (ROOT / "web" / "lib" / "copy.js").read_text(encoding="utf-8")
        found = re.findall(r"export const DEFAULT_EXPIRY_DAYS = (\d+);", source)
        self.assertEqual(1, len(found), "DEFAULT_EXPIRY_DAYS is missing or defined twice")
        self.assertEqual(SHARE_LINK_DAYS, int(found[0]),
                         "the share screen offers one default and the server applies another")

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

    def test_a_non_string_share_code_is_invalid_not_a_crash(self):
        """A non-string code hashed through str.encode and 500ed; a code that is not a string
        is no link anybody issued, so it gets the same 404 a wrong one does."""
        guest = self.session("guest")
        status, payload = self.post("/api/share-links/redeem", {"token": ["made-up"]},
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

    def test_a_revoked_person_cannot_re_redeem_their_way_back(self):
        """The hole an adversarial review found on 2026-09-16.

        grant_level() reports None both for a stranger and for somebody who was thrown off,
        so redeeming treated the two alike and the upsert put them straight back — with the
        QR code still in their camera roll, one request, nobody with authority involved, for
        as long as the code lived. The owner's only remedy was to guess which code they used
        and turn that off too, which also shuts out everyone yet to redeem it.
        """
        owner, board = self.board()
        guest = self.session("guest")
        _, issued = self.link(owner["token"], board, level="contribute")
        status, _ = self.post("/api/share-links/redeem", {"token": issued["token"]},
                              token=guest["token"])
        self.assertEqual(200, status)

        self.post("/api/grants/revoke", {"storyboard_id": board, "user_id": guest["user_id"]},
                  token=owner["token"])
        before = self.db.share_link(issued["share_link_id"])["used_count"]

        status, payload = self.post("/api/share-links/redeem", {"token": issued["token"]},
                                    token=guest["token"])
        self.assertEqual(403, status)
        self.assertEqual("access_revoked", payload["error"]["code"])
        self.assertIsNone(self.db.grant_level(board, guest["user_id"]),
                          "re-redeeming resurrected a revoked grant")
        seen, _ = self.get(f"/api/timeline?storyboard_id={board}", token=guest["token"])
        self.assertEqual(403, seen)
        # A redemption that grants nothing must not spend one of the link's uses, or being
        # refused would quietly burn a code the owner is still handing out.
        self.assertEqual(before, self.db.share_link(issued["share_link_id"])["used_count"])

    def test_the_owner_can_still_let_a_revoked_person_back_on(self):
        # Revocation sticks against the person it was applied to, not against the owner's
        # ability to change their mind. grant() is the path that clears it, and it is called
        # by somebody entitled to make that call.
        owner, board = self.board()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "contribute", owner["user_id"])
        self.post("/api/grants/revoke", {"storyboard_id": board, "user_id": guest["user_id"]},
                  token=owner["token"])
        self.assertIsNone(self.db.grant_level(board, guest["user_id"]))

        self.db.grant(board, guest["user_id"], "contribute", owner["user_id"])
        self.assertEqual("contribute", self.db.grant_level(board, guest["user_id"]))
        seen, _ = self.get(f"/api/timeline?storyboard_id={board}", token=guest["token"])
        self.assertEqual(200, seen)

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


class ScreeningTheShortFields(Fixture):
    """The storyboard title and the closing note, which reach the Screener since #36.

    operations.md §1.1 had recorded leaving them out as a decision rather than an oversight,
    and the report line that came with it was carefully worded: bodies are screened, the two
    title-ish fields are held by constraints. What changed is the first of its three reasons
    — there is a quota check on these paths now, so the model call is metered like any other
    — and what it cost, one call on two rare actions, was weighed against a title being the
    line everyone reads first and the one place an address could sit unscreened.

    The other two reasons are answered by shape rather than by argument, and these pin both:
    a title marked review stays out of the queue, which is right because its author is the
    owner; and the audit row now says 'storyboard' instead of having nowhere to point.
    """

    def create(self, token, title="Fence at number 12", *replies):
        self.client.replies = list(replies) or [OK_JSON]
        return self.post("/api/storyboards", {"title": title}, token=token)

    def close(self, token, board, note, *replies):
        self.client.replies = list(replies) or [OK_JSON]
        return self.post("/api/storyboards/close",
                         {"storyboard_id": board, "closed_note": note}, token=token)

    def screened(self):
        """(field, text) for each call the Screener actually saw."""
        return [(re.search(r"^field: (\w+)$", c["content"], re.M).group(1), c["content"])
                for c in self.client.calls if c["role"] == "screener"]

    def test_a_title_goes_to_the_screener_and_is_recorded_against_its_storyboard(self):
        who = self.session()
        status, made = self.create(who["token"], "Fence at number 12")
        self.assertEqual(200, status)

        seen = self.screened()
        self.assertEqual(["storyboard_title"], [field for field, _ in seen])
        self.assertIn("Fence at number 12", seen[0][1])
        row = self.rows()[0]
        self.assertEqual(("storyboard", made["storyboard_id"], "storyboard_title", "ok"),
                         (row["subject_type"], row["subject_id"], row["field"], row["verdict"]))
        self.assertEqual(who["user_id"], row["author_id"])

    def test_a_refused_title_creates_no_storyboard(self):
        who = self.session()
        status, payload = self.create(who["token"], "He lives at 42 Example St", REJECT_JSON)

        self.assertEqual(200, status, "a refusal is an answer, not an error")
        self.assertFalse(payload["published"])
        self.assertEqual(["pii"], payload["reason_codes"])
        self.assertNotIn("storyboard_id", payload)
        self.assertEqual([], self.get("/api/dashboard", token=who["token"])[1]["active"])
        row = self.rows()[0]
        self.assertEqual("submission", row["subject_type"], "it pointed at a storyboard "
                         "that was never made")
        self.assertIsNone(row["subject_id"])
        self.assertEqual("He lives at 42 Example St", row["original_text"])

    def test_a_title_marked_review_is_published_and_stays_out_of_the_queue(self):
        """Reason (2) in the old decision, answered rather than dodged. The author of a
        title is the owner of the storyboard, so a queue entry would be asking somebody to
        review their own words — and every review read filters on subject_type = 'entry'.
        """
        who = self.session()
        status, made = self.create(who["token"], "Fence at number 12", REVIEW_JSON)
        self.assertEqual(200, status)
        self.assertIn("storyboard_id", made)
        self.assertEqual("review", self.rows()[0]["verdict"])

        queue = self.get(f"/api/review?storyboard_id={made['storyboard_id']}",
                         token=who["token"])[1]
        self.assertEqual([], queue["items"])

    def test_a_closing_note_is_screened_too(self):
        owner, board = self.board()
        status, payload = self.close(owner["token"], board, "that was the last of them")

        self.assertEqual(200, status)
        self.assertEqual("archived", payload["status"])
        self.assertEqual(["closed_note"], [field for field, _ in self.screened()])
        row = self.rows()[0]
        self.assertEqual(("storyboard", board, "closed_note"),
                         (row["subject_type"], row["subject_id"], row["field"]))

    def test_a_refused_note_leaves_the_storyboard_open(self):
        """Archiving anyway and dropping the note would be quieter and wrong: closing is
        deliberate and the note is how it is explained, so the owner picks other words rather
        than finding their storyboard shut with nothing said.
        """
        owner, board = self.board()
        status, payload = self.close(owner["token"], board, "Come to 42 Example St", REJECT_JSON)

        self.assertEqual(200, status)
        self.assertFalse(payload["published"])
        self.assertEqual(["pii"], payload["reason_codes"])
        active = self.get("/api/dashboard", token=owner["token"])[1]["active"]
        self.assertEqual([board], [b["id"] for b in active], "it was archived anyway")

    def test_an_outsider_is_refused_before_the_model_is_asked(self):
        """The owner check first: an outsider's note on somebody else's storyboard should
        cost a 403, not a model call.
        """
        owner, board = self.board()
        guest = self.session("guest")
        self.db.grant(board, guest["user_id"], "reshare", owner["user_id"])

        status, _ = self.close(guest["token"], board, "closing this for you")

        self.assertEqual(403, status)
        self.assertEqual([], self.screened())

    def test_nothing_to_judge_is_not_a_model_call(self):
        """Both fields are optional, so this is the ordinary case rather than an edge one.
        A screener call on "" spends a slice of the day's ceiling to be told nothing.
        """
        who = self.session()
        self.client.replies = []
        _, made = self.post("/api/storyboards", {}, token=who["token"])
        self.post("/api/storyboards/close", {"storyboard_id": made["storyboard_id"]},
                  token=who["token"])

        self.assertEqual([], self.screened())
        self.assertEqual([], self.rows())
        past = self.get("/api/dashboard", token=who["token"])[1]["past"]
        self.assertEqual([made["storyboard_id"]], [b["id"] for b in past])

    def test_the_title_spends_from_the_same_quota_as_a_submission(self):
        """A model call on an unmetered path is the hole #33 closed for the assistant. The
        global ceiling on the client catches it too, but a per-user bucket is what keeps one
        person from spending everybody's day.
        """
        who = self.session()
        with mock.patch.dict(DEFAULT_LIMITS, {"submission": (1, 3600)}):
            self.assertEqual(200, self.create(who["token"], "First one")[0])
            status, payload = self.create(who["token"], "Second one")

        self.assertEqual(429, status)
        self.assertEqual("submission", payload["error"]["scope"])
        self.assertEqual(1, len(self.rows()), "the refused call still reached the model")


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

    def test_a_long_thread_comes_back_one_page_at_a_time(self):
        """A reply body runs to the free-text cap, so the length of this list is the size of
        the response. Unbounded, a few thousand replies walk into the 4.5 MB platform cap, the
        way the timeline did. Paged the same way: a page, a cursor, and the next page after it.
        """
        owner, board = self.board()
        _, created = self.thread(owner["token"], board)   # the opening post is post one
        tid = created["thread_id"]
        # Seed past a page directly rather than through forty screened calls: the paging is what
        # this test is about, not the Screener, which has its own tests above.
        for i in range(40):
            self.db.add_post(tid, owner["user_id"], f"reply number {i}")

        status, first = self.get(f"/api/forum/thread?thread_id={tid}", token=owner["token"])
        self.assertEqual(200, status)
        self.assertEqual(30, len(first["posts"]), "a page is FORUM_PAGE replies")
        self.assertEqual(first["posts"][-1]["id"], first["next"],
                         "the cursor is the last reply on the page")

        status, second = self.get(f"/api/forum/thread?thread_id={tid}&after={first['next']}",
                                  token=owner["token"])
        self.assertEqual(200, status)
        self.assertEqual(11, len(second["posts"]), "1 opening + 40 = 41, so 30 then 11")
        self.assertIsNone(second["next"], "the second page is the end")
        self.assertEqual(set(), {p["id"] for p in first["posts"]}
                                & {p["id"] for p in second["posts"]},
                         "no reply appears on both pages")

    def test_a_cursor_this_thread_never_issued_is_a_bad_request(self):
        """The server refuses an unknown cursor rather than silently restarting at page one —
        the same choice the timeline makes, so a bug cannot make the two diverge."""
        owner, board = self.board()
        _, created = self.thread(owner["token"], board)
        status, payload = self.get(
            f"/api/forum/thread?thread_id={created['thread_id']}&after=not-a-real-post",
            token=owner["token"])
        self.assertEqual(400, status)
        self.assertEqual("bad_request", payload["error"]["code"])


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

    def test_two_votes_cannot_publicly_mark_an_entry_nobody_screened(self):
        """The hole an adversarial review found on 2026-09-16.

        dispose() updated every undisposed screening row for the entry, and every entry has
        one per field including the ones the Screener passed. So two `worth_checking` votes
        reached past the queue and stamped an `ok` row `labelled`, which is exactly what the
        timeline reads to show "being checked". Worse, awaiting_review() does filter on the
        verdict, so the owner had no button to undo it: a clean entry could be marked in
        public, permanently, by two neighbours.
        """
        owner, board = self.board("owner")
        clean = self.submit(owner["token"], board, OK_JSON,
                            fun_fact="Brushtails are nocturnal.", story=None)[1]["entry_id"]
        for who in ("first", "second"):
            neighbour = self.session(who)
            self.db.grant(board, neighbour["user_id"], "contribute", owner["user_id"])
            status, _ = self.vote(neighbour["token"], clean, "worth_checking")
            self.assertEqual(200, status)

        _, view = self.get(f"/api/timeline?storyboard_id={board}", token=owner["token"])
        marked = [e for e in view["entries"] if e["id"] == clean]
        self.assertEqual(1, len(marked), "the entry vanished from the timeline")
        self.assertFalse(marked[0]["being_checked"],
                         "two votes publicly marked an entry the screener had passed")

    def test_two_votes_still_settle_an_entry_that_is_really_in_review(self):
        # The designed path, unchanged: the Screener marked this one, so the queue has it
        # and two marks settle it.
        owner, guest, board, entry_id = self.flagged()
        second = self.session("second")
        self.db.grant(board, second["user_id"], "contribute", owner["user_id"])
        self.vote(guest["token"], entry_id, "worth_checking")
        self.vote(second["token"], entry_id, "worth_checking")

        _, view = self.get(f"/api/timeline?storyboard_id={board}", token=guest["token"])
        marked = [e for e in view["entries"] if e["id"] == entry_id]
        self.assertTrue(marked[0]["being_checked"],
                        "an entry really in review stopped being settled by two votes")

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

    def test_two_worth_checking_apply_the_public_label_and_leave_it_open(self):
        """The label is a public mark, not an ending.

        This used to assert the entry left the queue, and that assertion was the defect.
        operations.md §2.1 gives the owner the final say over a labelled entry, §2.2 lets two
        "looks right" votes clear the mark, and §2.2 clears it automatically after seven days.
        None of the three can happen to a row the queries treat as finished — and the owner's
        disposal has exactly one surface in the product: the controls rendered per item in
        this queue, web/app/b/[id]/review/page.js:81 being the only caller of disposeEntry.
        An entry that left the queue on being labelled took the owner's final say with it.
        """
        owner, guest, board, entry_id = self.flagged()
        second = self.session("second")
        self.db.grant(board, second["user_id"], "contribute", owner["user_id"])
        self.vote(guest["token"], entry_id, "worth_checking")
        self.vote(second["token"], entry_id, "worth_checking")
        _, view = self.get(f"/api/timeline?storyboard_id={board}", token=owner["token"])
        self.assertEqual(1, view["entries"][0]["being_checked"])
        still_there = self.queue(guest["token"], board)[1]["items"]
        self.assertEqual([entry_id], [item["entry_id"] for item in still_there])
        self.assertEqual(2, still_there[0]["worth_checking"])

    def test_the_owner_can_lift_a_public_label(self):
        """§2.1, which was unreachable: dispose answered 409 not_in_review on a labelled
        entry, so the mark was permanent and nobody had the button."""
        owner, guest, board, entry_id = self.flagged()
        second = self.session("second")
        self.db.grant(board, second["user_id"], "contribute", owner["user_id"])
        self.vote(guest["token"], entry_id, "worth_checking")
        self.vote(second["token"], entry_id, "worth_checking")
        status, _ = self.post("/api/review/dispose",
                              {"entry_id": entry_id, "action": "kept"}, token=owner["token"])
        self.assertEqual(200, status)
        _, view = self.get(f"/api/timeline?storyboard_id={board}", token=owner["token"])
        self.assertEqual(0, view["entries"][0]["being_checked"])
        # Kept is an ending, so now it does leave.
        self.assertEqual([], self.queue(guest["token"], board)[1]["items"])

    def test_two_looks_right_clear_a_label_that_was_already_applied(self):
        """§2.2's second row, also unreachable before: once labelled, a later pair of
        "looks right" votes matched no rows and the mark stayed up."""
        owner, guest, board, entry_id = self.flagged()
        second = self.session("second")
        self.db.grant(board, second["user_id"], "contribute", owner["user_id"])
        self.vote(guest["token"], entry_id, "worth_checking")
        self.vote(second["token"], entry_id, "worth_checking")
        # Both change their minds. One vote each, changeable.
        self.vote(guest["token"], entry_id, "looks_right")
        self.vote(second["token"], entry_id, "looks_right")
        _, view = self.get(f"/api/timeline?storyboard_id={board}", token=owner["token"])
        self.assertEqual(0, view["entries"][0]["being_checked"])

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

    def test_a_stranger_learns_nothing_about_what_is_under_review(self):
        """The order of the two checks is load-bearing, not tidiness.

        operations §2.3: an author is never told their entry was marked. If disposal asked
        "is this under review?" before "do you own this storyboard?", the error code would
        answer that question for anybody holding an entry id — 409 not_in_review for an
        unmarked one, 403 not_the_owner for a marked one. The author could read their own
        status straight off it.

        A mutation run found this: swapping the two checks broke nothing in the suite.
        """
        owner, board = self.board("owner")
        neighbour = self.session("neighbour")
        self.db.grant(board, neighbour["user_id"], "contribute", owner["user_id"])
        _, plain = self.submit(neighbour["token"], board, OK_JSON, story="never marked")
        _, marked = self.submit(neighbour["token"], board, REVIEW_JSON,
                                fun_fact="Ringtails live about 40 years.", story=None)

        # The author is not the owner here, so both must answer the same way, and it must
        # be the answer that says nothing about review.
        for entry_id, what in ((plain["entry_id"], "unmarked"), (marked["entry_id"], "marked")):
            status, out = self.post("/api/review/dispose",
                                    {"entry_id": entry_id, "action": "removed"},
                                    token=neighbour["token"])
            self.assertEqual(403, status, f"the {what} entry answered something else")
            self.assertEqual("not_the_owner", out["error"]["code"],
                             f"the {what} entry gave its review status away")

    def test_an_entry_nobody_marked_cannot_be_disposed_of(self):
        """The owner's disposal is the end of a review, not a general delete.

        dispose_entry checked three things: the entry exists, it is not already deleted, and
        the caller owns the storyboard. It never checked that anybody had marked the entry,
        and db.dispose removes it regardless: the UPDATE on screening_results matches no row
        and says nothing, while the UPDATE that sets deleted_at runs anyway.

        So an owner could quietly delete any entry on their storyboard, from anyone, at any
        time, and leave no disposal record behind. Everything else in the product says that
        is not the arrangement: deleting an entry belongs to its author, the queue holds
        "entries awaiting a second look", and centralised moderation is on the list of
        things CLAUDE.md rules out.
        """
        owner, board = self.board("owner")
        neighbour = self.session("neighbour")
        self.db.grant(board, neighbour["user_id"], "contribute", owner["user_id"])
        _, mine = self.submit(neighbour["token"], board, OK_JSON, story="on the fence at eleven")
        entry_id = mine["entry_id"]

        status, out = self.post("/api/review/dispose",
                                {"entry_id": entry_id, "action": "removed"},
                                token=owner["token"])
        self.assertEqual(409, status, "the owner deleted an entry nobody had marked")
        self.assertEqual("not_in_review", out["error"]["code"])

        _, view = self.get(f"/api/timeline?storyboard_id={board}", token=neighbour["token"])
        self.assertEqual(["on the fence at eleven"], [e["story"] for e in view["entries"]],
                         "the entry went anyway")

    def test_a_marked_entry_can_still_be_disposed_of(self):
        """The other half: the power itself is real and has to keep working."""
        owner, guest, board, entry_id = self.flagged()
        status, out = self.post("/api/review/dispose",
                                {"entry_id": entry_id, "action": "removed"},
                                token=owner["token"])
        self.assertEqual(200, status)
        self.assertEqual("removed", out["disposition"])

    def test_an_entry_already_settled_cannot_be_disposed_of_twice(self):
        """Once the review is closed there is nothing left to have the last word on, and a
        second disposal would be the general delete arriving by another route.
        """
        owner, guest, board, entry_id = self.flagged()
        self.assertEqual(200, self.post("/api/review/dispose",
                                        {"entry_id": entry_id, "action": "kept"},
                                        token=owner["token"])[0])
        status, out = self.post("/api/review/dispose",
                                {"entry_id": entry_id, "action": "removed"},
                                token=owner["token"])
        self.assertEqual(409, status)
        self.assertEqual("not_in_review", out["error"]["code"])

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


class SigningOut(Fixture):
    """POST /api/sessions/revoke — the server agreeing to what the button already said.

    Until 2026-09-18 signing out was a front-end act only: api.js cleared localStorage and
    the token it discarded stayed valid. And it stayed valid for ever, because a token was
    `<user_id>.<signature>` with no issue time in it, so there was nothing to expire and
    nothing but rotating the server secret — which signs out everybody — to revoke. A
    signed-in account keeps its token in localStorage by design, and there is no password
    reset, so a captured one was permanent access to that account and the product's only
    remedy did nothing about it.

    One column carries the fix. users.tokens_valid_from is a cutoff; anything issued before
    it is refused. See data-model.md §1.2.
    """

    GOOD = "correct horse battery staple"

    def account(self, handle="ada_l"):
        status, out = self.post("/api/register", {"handle": handle, "password": self.GOOD})
        self.assertEqual(200, status, out)
        return out

    def works(self, token):
        """Does this token still open anything? Uses a route that needs nothing but identity."""
        status, _ = self.get("/api/dashboard", token=token)
        return status == 200

    def test_signing_out_stops_the_token_that_asked(self):
        """The one the whole thing is for. Before this the answer was "no, it works for ever"."""
        who = self.account()
        self.assertTrue(self.works(who["token"]))
        status, payload = self.post("/api/sessions/revoke", {}, token=who["token"])
        self.assertEqual(200, status)
        self.assertTrue(payload["signed_out"])
        self.assertFalse(self.works(who["token"]), "the token outlived signing out")

    def test_it_stops_every_token_that_person_holds_and_not_only_the_newest(self):
        """Two browsers, one account. Signing out of one signs out of both, because there is
        no session table to be selective with and "sign out" on the only button the product
        has is fairly read as all of them."""
        who = self.account()
        _, second = self.post("/api/login", {"handle": "ada_l", "password": self.GOOD})
        self.assertTrue(self.works(second["token"]))
        self.post("/api/sessions/revoke", {}, token=who["token"])
        self.assertFalse(self.works(second["token"]), "the other browser stayed signed in")

    def test_signing_in_again_works_straight_afterwards(self):
        """The cutoff must not lock the account out of itself. A token minted after the
        cutoff is later than it, including one minted in the same second — which is why the
        comparison admits equality rather than demanding strictly later."""
        who = self.account()
        self.post("/api/sessions/revoke", {}, token=who["token"])
        _, back = self.post("/api/login", {"handle": "ada_l", "password": self.GOOD})
        self.assertTrue(self.works(back["token"]), "signing back in did not work")

    def test_it_signs_out_nobody_else(self):
        first = self.account("ada_l")
        second = self.account("neighbour-b")
        self.post("/api/sessions/revoke", {}, token=first["token"])
        self.assertTrue(self.works(second["token"]), "it signed out the wrong person")

    def test_it_needs_a_token_of_its_own(self):
        """Not _tokenless: you cannot sign somebody else out, and there is no user id in the
        body that could name them."""
        for token in (None, "nonsense", "u1.1.deadbeef"):
            with self.subTest(token=str(token)[:12]):
                status, payload = self.post("/api/sessions/revoke", {}, token=token)
                self.assertEqual(401, status)
                self.assertEqual("unauthorized", payload["error"]["code"])

    def test_signing_out_twice_is_not_an_error_for_the_first_one(self):
        """A client retrying on a dropped connection must not get a 500. The second call
        arrives with a token the first one already refused, so it is a 401 — signed out
        either way, which is the state the caller wanted."""
        who = self.account()
        self.assertEqual(200, self.post("/api/sessions/revoke", {}, token=who["token"])[0])
        status, _ = self.post("/api/sessions/revoke", {}, token=who["token"])
        self.assertEqual(401, status)

    def test_a_guest_cannot_be_signed_out_by_whoever_holds_its_handle(self):
        """This test used to be test_a_guest_can_sign_out_too, and it pinned the hole.

        Under FENCEPOST_OPEN_SIGNUP anybody who reads @wanderer off a storyboard can exchange
        that handle for a token of their own - the same user id - and a revoke with it would
        sign the real guest out. In a loop, faster than the client's single retry, that is a
        remote lockout of somebody's identity. Found by the pre-deploy review. A guest gains
        nothing from signing out anyway: the handle re-exchanges at once.
        """
        guest = self.session("wanderer")
        stranger = self.session("wanderer")              # same handle, so the same person
        self.assertEqual(guest["user_id"], stranger["user_id"])   # as far as the server knows
        status, payload = self.post("/api/sessions/revoke", {}, token=stranger["token"])
        self.assertEqual(403, status)
        self.assertEqual("not_an_account", payload["error"]["code"])
        self.assertTrue(self.works(guest["token"]), "a stranger signed the guest out")

    def test_the_cutoff_is_the_only_thing_written(self):
        """Signing out is not a delete. What somebody wrote stays theirs and stays on the
        storyboard; this ends a session, and reading it as anything more would lose content
        nobody asked to remove."""
        who = self.account()
        board = self.db.add_storyboard(who["user_id"], "Mine")
        self.db.grant(board, who["user_id"], "reshare", who["user_id"])
        self.db.add_entry(board, who["user_id"], "ringtail", story="still mine afterwards")
        self.post("/api/sessions/revoke", {}, token=who["token"])
        _, back = self.post("/api/login", {"handle": "ada_l", "password": self.GOOD})
        view = self.get(f"/api/timeline?storyboard_id={board}", token=back["token"])[1]
        self.assertEqual(["still mine afterwards"], [e["story"] for e in view["entries"]])
        row = self.db.conn.execute("SELECT password_hash, tokens_valid_from FROM users "
                                   "WHERE id = ?", (who["user_id"],)).fetchone()
        self.assertIsNotNone(row["password_hash"], "signing out cleared the password")
        self.assertIsNotNone(row["tokens_valid_from"])

    def test_the_cutoff_is_in_the_token_own_units_and_not_a_stamp(self):
        """The one column in this schema that is not an ISO stamp, and the reason is the
        reason this class exists twice over: it is compared against the issue time inside a
        bearer token, so it has to be in that number's units and at finer than a second.
        The first attempt stored a TIMESTAMP and converted on read — which passed a suite
        happily while making signing out in the second you signed in do nothing at all."""
        who = self.account()
        before = self.db.revoke_tokens(who["user_id"])
        stored = self.db.conn.execute("SELECT tokens_valid_from FROM users WHERE id = ?",
                                      (who["user_id"],)).fetchone()["tokens_valid_from"]
        self.assertIsInstance(stored, int)
        self.assertEqual(before, stored)
        self.assertEqual(stored, self.db.tokens_valid_from(who["user_id"]))
        # Milliseconds, not seconds: a second-resolution value here is roughly 1.8e9, and
        # the difference is the whole bug. Pinned so a "tidy-up" to seconds cannot pass.
        self.assertGreater(stored, 1_600_000_000_000)

    def test_a_token_issued_in_the_same_second_as_the_sign_out_is_refused(self):
        """The case that second resolution could not express, and the case that matters
        most: somebody realises they are on a shared computer and signs out at once. With a
        cutoff to the second, the token they had just been given was not older than the
        cutoff, so it survived — and the button reported success."""
        who = self.account()
        self.assertTrue(self.works(who["token"]))
        self.post("/api/sessions/revoke", {}, token=who["token"])
        self.assertFalse(self.works(who["token"]),
                         "signing out in the same second did nothing")

    def test_never_signed_out_and_no_such_person_are_different_answers(self):
        """NULL in the column, so no backfill; 0 out of the accessor, so "exists and never
        signed out" cannot be mistaken for "does not exist". They used to be the same None,
        and the second was admitted as a ghost."""
        who = self.account()
        self.assertEqual(0, self.db.tokens_valid_from(who["user_id"]))
        self.assertIsNone(self.db.tokens_valid_from("no-such-user"))

    def test_a_token_for_somebody_who_no_longer_exists_is_refused(self):
        """scripts/teardown_demo.py deletes every users row. A browser still holding a token
        from before it used to carry on as a ghost: reads answered 200 and empty, writes
        failed a foreign key and came back as a 500 saying the assistant was offline, and
        the client's 401 recovery never ran because no 401 ever came. Found by the
        pre-deploy review."""
        who = self.account()
        self.assertTrue(self.works(who["token"]))
        self.db.conn.execute("DELETE FROM users WHERE id = ?", (who["user_id"],))
        self.db.conn.commit()
        status, payload = self.get("/api/dashboard", token=who["token"])
        self.assertEqual(401, status, "a token outlived the person it was issued to")
        self.assertEqual("unauthorized", payload["error"]["code"])

    # -- TOK-1, TOK-2, TOK-6: the clock ----------------------------------------------------
    #
    # The first version compared the asking token with a cutoff read from this instance's
    # clock. A token stamped by a faster instance - within the five minutes of slack verify
    # allows - was later than that cutoff and survived its own sign-out, and a coarse clock
    # (15.6 ms on Python 3.12 under Windows) made the same thing happen inside one tick. The
    # tie rule that decides it was never exercised by any test: flipping < to <= passed the
    # whole suite, although it had been reported as pinned. Found by the pre-deploy review.

    def test_a_token_stamped_ahead_of_this_clock_is_still_signed_out(self):
        """A token from an instance running a minute fast. It asks to sign out, is told
        signed_out, and must actually stop working."""
        who = self.account()
        ahead = auth.issue(who["user_id"], auth.now_ms() + 60_000)
        self.assertTrue(self.works(ahead), "the drifted token should work before sign-out")
        self.assertEqual(200, self.post("/api/sessions/revoke", {}, token=ahead)[0])
        self.assertFalse(self.works(ahead), "a fast instance's token survived its sign-out")
        _, back = self.post("/api/login", {"handle": "ada_l", "password": self.GOOD})
        self.assertTrue(self.works(back["token"]),
                        "after that sign-out, signing back in was refused until the drift passed")

    def test_sign_out_and_sign_in_inside_one_tick_of_the_clock(self):
        """The clock frozen, so every reading is the same millisecond: the coarsest clock
        there could be. The asking token must die, and a sign-in in the same instant must
        still be good - possible only because the cutoff is written past the asking token and
        the next token is minted at or above it."""
        who = self.account()
        frozen = auth.now_ms()
        with mock.patch.object(auth, "now_ms", lambda: frozen):
            token = auth.issue(who["user_id"])
            self.assertTrue(self.works(token))
            self.assertEqual(200, self.post("/api/sessions/revoke", {}, token=token)[0])
            self.assertFalse(self.works(token), "sign-out did nothing inside one tick")
            _, back = self.post("/api/login", {"handle": "ada_l", "password": self.GOOD})
            self.assertTrue(self.works(back["token"]), "signing back in inside the tick failed")

    def test_a_later_sign_out_never_lowers_the_cutoff(self):
        """Two sign-outs of one account at once, one asking with a token from a fast
        instance. Whichever lands second must not bring the other's token back. Found by the
        pre-deploy recheck with the interleaving forced; this is that order, without HTTP."""
        who = self.account()
        high = self.db.revoke_tokens(who["user_id"], at_least=auth.now_ms() + 60_000)
        self.assertEqual(high, self.db.revoke_tokens(who["user_id"]),
                         "the second sign-out moved the cutoff backwards")

    def test_a_token_expiring_during_sign_out_is_a_refusal_not_a_500(self):
        """sign_out used to verify the token a second time to read its stamp. One that
        expired between the two checks escaped as a 500 saying the assistant was offline.
        The clock here ticks a millisecond per reading, starting on the expiry line."""
        who = self.account()
        start = auth.now_ms()
        token = auth.issue(who["user_id"], start - auth.TTL_MS)
        ticks = iter(range(start, start + 10_000))
        with mock.patch.object(auth, "now_ms", lambda: next(ticks)):
            status, payload = self.post("/api/sessions/revoke", {}, token=token)
        self.assertNotEqual(500, status, payload)

    def test_the_cutoff_admits_equality_and_nothing_below_it(self):
        """The tie rule itself, pinned directly rather than hoped for through /api/login,
        which runs scrypt first and so never reaches a tie."""
        who = self.account()
        line = auth.now_ms() - 1000
        self.db.conn.execute("UPDATE users SET tokens_valid_from = ? WHERE id = ?",
                             (line, who["user_id"]))
        self.db.conn.commit()
        self.assertTrue(self.works(auth.issue(who["user_id"], line)), "equal was refused")
        self.assertFalse(self.works(auth.issue(who["user_id"], line - 1)), "below was admitted")

    def test_a_signed_out_token_cannot_reach_the_model_either(self):
        """The assistant is the one route that costs money, and the one the "Sign in again"
        copy is named after. Every other test here checks revocation through /api/dashboard,
        and every assistant test elsewhere runs with no database, so a refactor that let
        _admit skip the cutoff passed all 356 of them. Found by the pre-deploy review.
        JSON and SSE both, because they share _admit and only one of them had been probed."""
        who = self.account()
        _, made = self.post("/api/storyboards", {"title": "Mine"}, token=who["token"])
        ask = {"role": "neighbour", "storyboard_id": made["storyboard_id"], "message": "hello"}
        self.assertEqual(200, self.post("/api/assistant", ask, token=who["token"])[0])
        calls = len(self.client.calls)
        self.post("/api/sessions/revoke", {}, token=who["token"])
        for stream in (False, True):
            with self.subTest(stream=stream):
                status, payload = self.post("/api/assistant", {**ask, "stream": stream},
                                            token=who["token"])
                self.assertEqual(401, status)
                self.assertEqual("unauthorized", payload["error"]["code"])
        self.assertEqual(calls, len(self.client.calls), "a signed-out token reached the model")


class SessionsPerAddress(Fixture):
    """The per-address ceiling on /api/session (operations §3).

    Open sign-up makes any handle a token, so a per-user limit is no limit on how many
    identities one caller can mint. This one counts by client address instead — kept as a
    keyed hash, never as the address itself.
    """

    CAP = 2

    def setUp(self):
        super().setUp()
        entry._DEPS.ceilings = SqliteCeilings(self.db)
        patcher = mock.patch.dict(CEILINGS, {"session": (self.CAP, 3600)})
        patcher.start()
        self.addCleanup(patcher.stop)
        # x-forwarded-for is trusted only on Vercel, where the platform sets it
        env = mock.patch.dict(os.environ, {"VERCEL": "1"})
        env.start()
        self.addCleanup(env.stop)

    def from_address(self, address, handle):
        request = urllib.request.Request(
            self.base + "/api/session", data=json.dumps({"handle": handle}).encode(),
            headers={"content-type": "application/json", "x-forwarded-for": address})
        try:
            resp = urllib.request.urlopen(request)
        except urllib.error.HTTPError as err:
            resp = err
        return resp.status, json.loads(resp.read())

    def test_the_cap_answers_429_and_other_addresses_are_unaffected(self):
        for n in range(self.CAP):
            self.assertEqual(200, self.from_address("203.0.113.7", f"fresh-{n}")[0])
        status, payload = self.from_address("203.0.113.7", "one-more")
        self.assertEqual(429, status)
        self.assertEqual({"code": "rate_limited", "scope": "session",
                          "message": COPY["rate_limited_session"]}, payload["error"])
        self.assertIsNone(self.db.user_by_handle("one-more"), "a refused request made a user")
        self.assertEqual(200, self.from_address("198.51.100.4", "next-door")[0])

    def test_the_first_forwarded_entry_is_the_one_counted(self):
        for n in range(self.CAP):
            self.from_address("203.0.113.7, 10.0.0.1", f"fresh-{n}")
        self.assertEqual(429, self.from_address("203.0.113.7, 10.0.0.2", "again")[0])

    def test_refusals_before_minting_spend_nothing(self):
        """Only a request about to mint a token counts, so a bad handle or a handle that
        belongs to an account cannot use up a network's allowance."""
        self.post("/api/register", {"handle": "has-a-password", "password": "long enough pw"})
        for _ in range(self.CAP + 2):
            self.assertEqual(400, self.from_address("203.0.113.7", "")[0])
            self.assertEqual(403, self.from_address("203.0.113.7", "has-a-password")[0])
        self.assertEqual(200, self.from_address("203.0.113.7", "fresh")[0])

    def test_a_returning_handle_spends_nothing(self):
        """A guest's browser keeps its handle but not its session (web/lib/api.js,
        exchangeGuest), so every page load exchanges the handle again. Counting those would
        let one busy classroom behind one address lock itself out within the hour. An
        existing handle is the same person under the same per-user limits, which is not what
        this ceiling is for. It is for new identities."""
        for n in range(self.CAP):
            self.assertEqual(200, self.from_address("203.0.113.7", f"fresh-{n}")[0])
        for _ in range(self.CAP + 3):
            self.assertEqual(200, self.from_address("203.0.113.7", "fresh-0")[0])
        self.assertEqual(429, self.from_address("203.0.113.7", "one-more")[0])

    def test_no_raw_address_is_stored(self):
        self.from_address("203.0.113.7", "fresh")
        buckets = [row["bucket"] for row in
                   self.db.conn.execute("SELECT bucket FROM ceilings").fetchall()]
        self.assertEqual(1, len(buckets))
        self.assertTrue(buckets[0].startswith("session:"))
        self.assertNotIn("203.0.113.7", buckets[0])
        self.assertEqual("session:" + auth.address_key("203.0.113.7"), buckets[0])

    def test_off_vercel_the_header_is_ignored(self):
        """Anywhere but Vercel nothing strips a client-supplied x-forwarded-for, so trusting
        it would let one caller be a new network on every request."""
        with mock.patch.dict(os.environ):
            os.environ.pop("VERCEL", None)
            for n in range(self.CAP):
                self.from_address(f"192.0.2.{n}", f"fresh-{n}")
            self.assertEqual(429, self.from_address("192.0.2.99", "spoofed")[0])


class PasswordCeilingPerAddress(Fixture):
    """The per-address ceiling on register and login (CEILINGS['password']).

    scrypt is memory-hard, and register plus a login for a handle nobody holds run it with no
    per-user counter to charge — an unauthenticated CPU/memory flood, and register grows the
    users table with it. Counted by client address like /api/session, kept as a keyed hash.
    """

    CAP = 2

    def setUp(self):
        super().setUp()
        entry._DEPS.ceilings = SqliteCeilings(self.db)
        patcher = mock.patch.dict(CEILINGS, {"password": (self.CAP, 900)})
        patcher.start()
        self.addCleanup(patcher.stop)
        env = mock.patch.dict(os.environ, {"VERCEL": "1"})
        env.start()
        self.addCleanup(env.stop)

    def _post(self, path, body, address):
        request = urllib.request.Request(
            self.base + path, data=json.dumps(body).encode(),
            headers={"content-type": "application/json", "x-forwarded-for": address})
        try:
            resp = urllib.request.urlopen(request)
        except urllib.error.HTTPError as err:
            resp = err
        return resp.status, json.loads(resp.read())

    def test_register_is_capped_per_address(self):
        for n in range(self.CAP):
            status, _ = self._post("/api/register",
                                   {"handle": f"acct-{n}", "password": "long enough pw"},
                                   "203.0.113.7")
            self.assertEqual(200, status)
        status, payload = self._post("/api/register",
                                     {"handle": "one-more", "password": "long enough pw"},
                                     "203.0.113.7")
        self.assertEqual(429, status)
        self.assertEqual("password", payload["error"]["scope"])
        self.assertIsNone(self.db.user_by_handle("one-more"), "a refused register wrote a row")
        self.assertEqual(200, self._post("/api/register",
                                         {"handle": "elsewhere", "password": "long enough pw"},
                                         "198.51.100.4")[0], "another network was affected")

    def test_login_for_an_unknown_handle_is_capped_per_address(self):
        """The path that used to run scrypt for free: a handle nobody holds. It shares the
        ceiling now, so a flood of guesses from one address is bounded."""
        for n in range(self.CAP):
            status, _ = self._post("/api/login",
                                   {"handle": f"nobody-{n}", "password": "whatever pw"},
                                   "203.0.113.9")
            self.assertEqual(401, status)
        status, payload = self._post("/api/login",
                                     {"handle": "nobody-more", "password": "whatever pw"},
                                     "203.0.113.9")
        self.assertEqual(429, status)
        self.assertEqual("password", payload["error"]["scope"])

    def test_a_malformed_request_is_refused_before_the_gate(self):
        """A short password is refused before the ceiling, so it neither reaches scrypt nor
        spends a network's allowance."""
        for _ in range(self.CAP + 2):
            self.assertEqual(400, self._post("/api/register",
                                             {"handle": "validname", "password": "x"},
                                             "203.0.113.7")[0])
        self.assertEqual(200, self._post("/api/register",
                                         {"handle": "finally", "password": "long enough pw"},
                                         "203.0.113.7")[0])


class Accounts(Fixture):
    """Registering and signing in with a password.

    Until 2026-09-15 identity was a handle and nothing else, which is why /api/session sits
    behind FENCEPOST_OPEN_SIGNUP: anybody could hand over anybody's handle and be given a
    token for it. These two endpoints are what make that flag removable.

    The two that matter most are further down: a handle held by a passwordless demo
    identity cannot be registered, and cannot be signed into with any password at all,
    the empty string included. mel_k owns the demo storyboard, and either of those going
    the other way hands it to whoever asks first.
    """

    GOOD = "correct horse battery staple"

    def signup(self, handle="ada_l", password=None):
        return self.post("/api/register", {"handle": handle, "password": password or self.GOOD})

    def signin(self, handle="ada_l", password=None):
        return self.post("/api/login", {"handle": handle, "password": password or self.GOOD})

    def stored_hash(self, handle):
        row = self.db.conn.execute("SELECT password_hash FROM users WHERE handle = ?",
                                   (handle,)).fetchone()
        return row["password_hash"] if row else None

    def test_registering_hands_back_a_token_that_works(self):
        status, out = self.signup()
        self.assertEqual(200, status)
        self.assertEqual("ada_l", out["handle"])
        # The token is the same kind the rest of the API takes, not a second scheme
        made = self.post("/api/storyboards", {"title": "Mine"}, token=out["token"])
        self.assertEqual(200, made[0])

    def test_the_password_is_not_in_the_database(self):
        self.signup()
        stored = self.stored_hash("ada_l")
        self.assertNotIn(self.GOOD, stored)
        self.assertTrue(stored.startswith("scrypt$"), stored[:20])

    def test_two_accounts_with_one_password_do_not_share_a_hash(self):
        """A missing salt is invisible until the day the table leaks, and then it decides
        how much of it is readable at once.
        """
        self.signup("ada_l")
        self.signup("grace_h")
        self.assertNotEqual(self.stored_hash("ada_l"), self.stored_hash("grace_h"))

    def test_a_taken_handle_is_refused(self):
        self.signup()
        status, out = self.signup()
        self.assertEqual(409, status)
        self.assertEqual("handle_taken", out["error"]["code"])

    def test_a_demo_identity_cannot_be_registered_over(self):
        """mel_k exists with no password because /api/session made them. Registering that
        name would hand the demo storyboard's owner to whoever asked for it first.
        """
        self.session("mel_k")
        status, out = self.signup("mel_k")
        self.assertEqual(409, status)
        self.assertEqual("handle_taken", out["error"]["code"])
        self.assertIsNone(self.stored_hash("mel_k"), "a password was set on somebody else")

    def test_a_demo_identity_cannot_be_signed_into(self):
        """The other half of the same door. password_hash IS NULL means this identity has
        no password, which is not the same as its password being empty. Reading it as the
        latter opens every demo account to anybody who sends an empty string.
        """
        self.session("mel_k")
        for guess in ["", " ", self.GOOD, "password", "null", "None"]:
            status, out = self.post("/api/login", {"handle": "mel_k", "password": guess})
            self.assertEqual(401, status, f"{guess!r} signed in as a passwordless identity")
            self.assertEqual("bad_credentials", out["error"]["code"])

    def test_a_short_password_is_refused(self):
        status, out = self.signup(password="short12")
        self.assertEqual(400, status)
        self.assertEqual("weak_password", out["error"]["code"])
        self.assertIsNone(self.stored_hash("ada_l"), "the account was created anyway")

    def test_a_password_longer_than_the_cap_is_refused(self):
        """Not a rule about passwords. scrypt is expensive on purpose, and anybody at all
        may call this endpoint, so the work it can be asked to do has to have an end.
        """
        status, _ = self.signup(password="p" * 201)
        self.assertEqual(400, status)

    def test_a_handle_has_to_be_one_word_of_a_sensible_length(self):
        for bad in ["ab", "a" * 25, "two words", "tab" + chr(9) + "bed", "   ", "", None, 42, ["a"]]:
            status, _ = self.post("/api/register", {"handle": bad, "password": self.GOOD})
            self.assertEqual(400, status, f"{bad!r} was accepted as a handle")

    def test_a_handle_does_not_have_to_be_english(self):
        """Refusing a non-Latin name would be the same mistake as rejecting a non-English
        sighting, which operations.md 4.3 already forbids. Somebody's name is a worse place
        to make it than their sighting.
        """
        name = "".join(chr(c) for c in (38463, 32599, 21704))
        status, out = self.post("/api/register", {"handle": name, "password": self.GOOD})
        self.assertEqual(200, status)
        self.assertEqual(name, out["handle"])

    def test_signing_in_returns_the_same_person(self):
        _, made = self.signup()
        status, back = self.signin()
        self.assertEqual(200, status)
        self.assertEqual(made["user_id"], back["user_id"])
        self.assertEqual("ada_l", back["handle"])

    def test_a_wrong_password_and_a_wrong_name_read_the_same(self):
        """Saying which half was wrong tells somebody whether that name exists. That is the
        first thing worth knowing to an attacker and no use at all to a person who mistyped
        their own password.
        """
        self.signup()
        wrong_password = self.post("/api/login",
                                   {"handle": "ada_l", "password": "nope-nope-nope"})
        no_such_person = self.post("/api/login",
                                   {"handle": "nobody_here", "password": self.GOOD})
        self.assertEqual(401, wrong_password[0])
        self.assertEqual(401, no_such_person[0])
        self.assertEqual(wrong_password[1], no_such_person[1])

    def test_an_account_cannot_be_entered_through_the_session_door(self):
        """The two endpoints have to agree about what a password is for.

        /api/login refuses a wrong password with some care. /api/session, beside it, used
        to hand out a token for the same person to anybody who typed their name, which made
        the password decorative and the refusal pointless. Measured against the deployment
        on 2026-09-15 before the fix: register, then ask /api/session for that handle, and
        it answered 200 with a token for the same user_id.
        """
        _, made = self.signup()
        status, out = self.post("/api/session", {"handle": "ada_l"})
        self.assertEqual(403, status, "an account was opened without its password")
        self.assertEqual("use_password", out["error"]["code"])
        self.assertNotIn("token", out)

    def test_an_identity_with_no_password_still_gets_a_token(self):
        """Guests are the reason open sign-up is on at all. Their handles have no password,
        so the check above must not touch them, or the site stops letting anybody in.
        """
        status, out = self.post("/api/session", {"handle": "guest_0123456789abcdef"})
        self.assertEqual(200, status)
        self.assertTrue(out["token"])

    def test_the_owner_of_a_storyboard_can_be_protected_this_way(self):
        """Why this matters beyond tidiness. An owner handle is printed beside every entry
        they wrote, and an owner token closes the storyboard, revokes everybody's access and
        disposes of other people's entries. Before this, reading the name off the screen was
        the whole of the attack.
        """
        self.session("mel_k")
        self.assertEqual(200, self.post("/api/session", {"handle": "mel_k"})[0],
                         "no password yet, so the door is still open")
        # Give that identity a password the way registering would, and the door shuts.
        self.db.conn.execute("UPDATE users SET password_hash = ? WHERE handle = ?",
                             ("scrypt$16384$8$1$c2FsdA==$aGFzaA==", "mel_k"))
        self.db.conn.commit()
        status, out = self.post("/api/session", {"handle": "mel_k"})
        self.assertEqual(403, status)
        self.assertEqual("use_password", out["error"]["code"])

    def test_registering_works_with_open_signup_closed(self):
        """The point of the whole change: this is what lets that flag go."""
        os.environ.pop("FENCEPOST_OPEN_SIGNUP", None)
        self.assertEqual(403, self.post("/api/session", {"handle": "ada_l"})[0])
        self.assertEqual(200, self.signup()[0])
        self.assertEqual(200, self.signin()[0])

    def test_guessing_stops_after_ten_tries(self):
        self.signup()
        codes = [self.post("/api/login", {"handle": "ada_l", "password": "wrong-one-x"})[0]
                 for _ in range(11)]
        self.assertEqual([401] * 10, codes[:10], "the ceiling closed early")
        self.assertEqual(429, codes[10], "guessing was never stopped")

    def test_the_right_password_is_refused_too_once_the_ceiling_is_hit(self):
        """A ceiling that still let the correct password through would stop nothing."""
        self.signup()
        for _ in range(10):
            self.post("/api/login", {"handle": "ada_l", "password": "wrong-one-x"})
        status, out = self.signin()
        self.assertEqual(429, status)
        self.assertEqual("rate_limited_login", out["error"]["code"])

    def test_one_account_being_hammered_does_not_lock_out_another(self):
        self.signup("ada_l")
        self.signup("grace_h")
        for _ in range(11):
            self.post("/api/login", {"handle": "ada_l", "password": "wrong-one-x"})
        self.assertEqual(200, self.signin("grace_h")[0], "the ceiling was counted globally")


class TakingDownYourOwnWords(Fixture):
    """Deleting a forum post, which nobody could do until 2026-09-15.

    An entry could always be deleted by whoever wrote it. A forum post could be deleted by
    nobody at all, including its author, while an owner could quietly remove anybody's entry
    through the disposal path. Neither half of that was a decision; the rule the product
    actually wants is the plain one: your own things are yours to take down, and nobody
    else's are.

    The data model was ready the whole time. deleted_at has been on both forum tables from
    the start and every read already filtered on it; only the endpoint was missing.
    """

    def thread_with_a_reply(self):
        """A thread started by the owner, with a neighbour's reply under it."""
        owner, board = self.board("owner")
        neighbour = self.session("neighbour")
        self.db.grant(board, neighbour["user_id"], "contribute", owner["user_id"])
        self.client.replies = [OK_JSON]
        _, thread = self.post("/api/forum/threads",
                              {"storyboard_id": board, "title": "Mango tree",
                               "body": "Stripped again overnight."}, token=owner["token"])
        self.client.replies = [OK_JSON]
        _, reply = self.post("/api/forum/posts",
                             {"thread_id": thread["thread_id"], "body": "Mine too, all week."},
                             token=neighbour["token"])
        return owner, neighbour, board, thread, reply

    def read(self, thread_id, token):
        return self.get(f"/api/forum/thread?thread_id={thread_id}", token=token)[1]

    def test_you_can_take_down_your_own_post(self):
        owner, neighbour, board, thread, reply = self.thread_with_a_reply()
        status, out = self.post("/api/forum/posts/delete",
                                {"post_id": reply["post_id"]}, token=neighbour["token"])
        self.assertEqual(200, status)
        self.assertTrue(out["deleted"])
        bodies = [p["body"] for p in self.read(thread["thread_id"], owner["token"])["posts"]]
        self.assertNotIn("Mine too, all week.", bodies)

    def test_you_cannot_take_down_somebody_elses(self):
        """The whole point of the rule, and the half that was already wrong in the other
        direction through the review disposal path.
        """
        owner, neighbour, board, thread, reply = self.thread_with_a_reply()
        status, out = self.post("/api/forum/posts/delete",
                                {"post_id": reply["post_id"]}, token=owner["token"])
        self.assertEqual(403, status, "the storyboard owner deleted a neighbour's post")
        self.assertEqual("not_your_post", out["error"]["code"])
        bodies = [p["body"] for p in self.read(thread["thread_id"], owner["token"])["posts"]]
        self.assertIn("Mine too, all week.", bodies, "it went anyway")

    def test_withdrawing_the_opening_post_leaves_the_replies_standing(self):
        """The title is what somebody else's reply hangs on. Taking the thread away with the
        opening post would delete their words along with mine, which is the same mistake
        seen from the other side.
        """
        owner, neighbour, board, thread, reply = self.thread_with_a_reply()
        opening = self.read(thread["thread_id"], owner["token"])["posts"][0]
        self.assertEqual(200, self.post("/api/forum/posts/delete",
                                        {"post_id": opening["id"]}, token=owner["token"])[0])

        view = self.read(thread["thread_id"], neighbour["token"])
        self.assertEqual(["Mine too, all week."], [p["body"] for p in view["posts"]])
        self.assertEqual("Mango tree", view["title"], "the reply lost the thread it was in")

    def test_a_thread_with_nothing_left_in_it_goes(self):
        """Otherwise the discussion list fills with titles that open onto nothing."""
        owner, board = self.board("owner")
        self.client.replies = [OK_JSON]
        _, thread = self.post("/api/forum/threads",
                              {"storyboard_id": board, "title": "Never mind",
                               "body": "Asked and answered."}, token=owner["token"])
        opening = self.read(thread["thread_id"], owner["token"])["posts"][0]
        self.post("/api/forum/posts/delete", {"post_id": opening["id"]}, token=owner["token"])

        _, listed = self.get(f"/api/forum?storyboard_id={board}", token=owner["token"])
        self.assertEqual([], [t["title"] for t in listed["threads"]])

    def test_taking_it_down_twice_is_gone(self):
        owner, neighbour, board, thread, reply = self.thread_with_a_reply()
        self.post("/api/forum/posts/delete", {"post_id": reply["post_id"]},
                  token=neighbour["token"])
        status, out = self.post("/api/forum/posts/delete", {"post_id": reply["post_id"]},
                                token=neighbour["token"])
        self.assertEqual(404, status)
        self.assertEqual("gone", out["error"]["code"])

    def test_an_archived_storyboard_takes_no_more_changes(self):
        """The same line delete_entry draws. A closed storyboard is a record, not a draft."""
        owner, neighbour, board, thread, reply = self.thread_with_a_reply()
        self.post("/api/storyboards/close", {"storyboard_id": board}, token=owner["token"])
        status, out = self.post("/api/forum/posts/delete",
                                {"post_id": reply["post_id"]}, token=neighbour["token"])
        self.assertEqual(409, status)
        self.assertEqual("storyboard_closed", out["error"]["code"])

    def test_the_interface_is_told_whose_post_it_is(self):
        """It has to draw the control on your own posts and not on anybody else's, and it
        compares author_id the way the timeline does rather than matching on the handle.
        """
        owner, neighbour, board, thread, reply = self.thread_with_a_reply()
        posts = self.read(thread["thread_id"], owner["token"])["posts"]
        self.assertEqual([owner["user_id"], neighbour["user_id"]],
                         [p["author_id"] for p in posts])


class TheOwnerClearingTheirOwnStoryboard(Fixture):
    """The deliberate exception to "only your own things are yours to remove".

    The rule the product wants is the plain one, and it holds everywhere else: an author
    deletes their own entries and posts, and delete_entry answers not_your_entry to anybody
    else. The exception is the person who made the space and invited people into it.

    What was wrong before was never that an owner could remove things. It was that the
    power had no name and left no trace: it arrived through the review disposal path, where
    db.dispose matched no screening row, said nothing, and set deleted_at regardless. So it
    is a named endpoint now, and the database records who did it.
    """

    def board_with_a_neighbours_entry(self):
        owner, board = self.board("owner")
        neighbour = self.session("neighbour")
        self.db.grant(board, neighbour["user_id"], "contribute", owner["user_id"])
        _, theirs = self.submit(neighbour["token"], board, OK_JSON, story="on the fence")
        return owner, neighbour, board, theirs["entry_id"]

    def stored(self, entry_id):
        return self.db.conn.execute(
            "SELECT deleted_at, removed_by FROM entries WHERE id = ?", (entry_id,)).fetchone()

    def test_the_owner_can_clear_somebody_elses_entry(self):
        owner, neighbour, board, entry_id = self.board_with_a_neighbours_entry()
        status, out = self.post("/api/entries/remove", {"entry_id": entry_id},
                                token=owner["token"])
        self.assertEqual(200, status)
        self.assertTrue(out["removed"])
        _, view = self.get(f"/api/timeline?storyboard_id={board}", token=neighbour["token"])
        self.assertEqual([], view["entries"])

    def test_who_removed_it_is_written_down(self):
        """The whole difference between this and the hole it replaces. Without the record
        an owner can empty a storyboard and nothing anywhere says it happened.
        """
        owner, neighbour, board, entry_id = self.board_with_a_neighbours_entry()
        self.post("/api/entries/remove", {"entry_id": entry_id}, token=owner["token"])
        row = self.stored(entry_id)
        self.assertTrue(row["deleted_at"])
        self.assertEqual(owner["user_id"], row["removed_by"])

    def test_an_author_withdrawing_their_own_leaves_no_such_mark(self):
        """NULL means the author took it down themselves, which needs no explaining. The
        two have to be told apart, or the record says nothing.
        """
        owner, neighbour, board, entry_id = self.board_with_a_neighbours_entry()
        self.post("/api/entries/delete", {"entry_id": entry_id}, token=neighbour["token"])
        row = self.stored(entry_id)
        self.assertTrue(row["deleted_at"])
        self.assertIsNone(row["removed_by"],
                          "an author's own withdrawal was blamed on somebody")

    def test_a_neighbour_cannot_clear_anybody(self):
        """Contribute is not a moderator. Only the owner of the space gets this."""
        owner, neighbour, board, entry_id = self.board_with_a_neighbours_entry()
        _, mine = self.submit(owner["token"], board, OK_JSON, story="the owner wrote this")
        status, out = self.post("/api/entries/remove", {"entry_id": mine["entry_id"]},
                                token=neighbour["token"])
        self.assertEqual(403, status)
        self.assertEqual("not_the_owner", out["error"]["code"])
        self.assertIsNone(self.stored(mine["entry_id"])["deleted_at"], "it went anyway")

    def test_a_closed_storyboard_is_a_record_not_a_draft(self):
        owner, neighbour, board, entry_id = self.board_with_a_neighbours_entry()
        self.post("/api/storyboards/close", {"storyboard_id": board}, token=owner["token"])
        status, out = self.post("/api/entries/remove", {"entry_id": entry_id},
                                token=owner["token"])
        self.assertEqual(409, status)
        self.assertEqual("storyboard_closed", out["error"]["code"])

    def test_the_review_path_is_still_only_for_what_was_marked(self):
        """The two must not collapse back into one. Disposal is the last word on something
        a neighbour marked; this is the owner tidying. If disposal starts accepting unmarked
        entries again, the named endpoint was pointless.
        """
        owner, neighbour, board, entry_id = self.board_with_a_neighbours_entry()
        status, out = self.post("/api/review/dispose",
                                {"entry_id": entry_id, "action": "removed"},
                                token=owner["token"])
        self.assertEqual(409, status)
        self.assertEqual("not_in_review", out["error"]["code"])

    def test_the_owner_can_clear_a_post_in_the_discussion(self):
        owner, board = self.board("owner")
        neighbour = self.session("neighbour")
        self.db.grant(board, neighbour["user_id"], "contribute", owner["user_id"])
        self.client.replies = [OK_JSON]
        _, thread = self.post("/api/forum/threads",
                              {"storyboard_id": board, "title": "Mango tree",
                               "body": "Stripped again."}, token=owner["token"])
        self.client.replies = [OK_JSON]
        _, reply = self.post("/api/forum/posts",
                             {"thread_id": thread["thread_id"], "body": "buy my thing"},
                             token=neighbour["token"])

        status, _ = self.post("/api/forum/posts/remove", {"post_id": reply["post_id"]},
                              token=owner["token"])
        self.assertEqual(200, status)
        _, view = self.get(f"/api/forum/thread?thread_id={thread['thread_id']}",
                           token=owner["token"])
        self.assertEqual(["Stripped again."], [p["body"] for p in view["posts"]])
        row = self.db.conn.execute("SELECT removed_by FROM forum_posts WHERE id = ?",
                                   (reply["post_id"],)).fetchone()
        self.assertEqual(owner["user_id"], row["removed_by"])


class YourOwnRecord(Fixture):
    """A count of what you have written, shown only to you.

    CLAUDE.md rules out points, streaks, badges and leaderboards, and the reason it gives
    is that they characterise contributors. That reason applies to a plain count as much as
    to a score the moment somebody else can read it, so the whole design of this is that
    nobody else can, and that it ranks nothing against anybody.

    What it is for is the useful half: "your last one was three days ago" is what reminds a
    person there is still footage on their phone. Nothing here rewards frequency, because a
    possum turning up is not something anybody can schedule, and a mechanism pushing for
    that would be pushing for invented sightings, which is a red line from the other end.
    """

    def record(self, token=None):
        return self.get("/api/record", token=token)

    def test_somebody_who_has_written_nothing_is_told_so(self):
        who = self.session("newcomer")
        status, out = self.record(who["token"])
        self.assertEqual(200, status)
        self.assertEqual(0, out["entries"])
        self.assertIsNone(out["latest_at"])

    def test_it_counts_what_you_wrote_and_when_you_last_did(self):
        who, board = self.board("mine")
        self.submit(who["token"], board, OK_JSON, story="on the fence at eleven")
        self.submit(who["token"], board, OK_JSON, story="along the powerline")
        status, out = self.record(who["token"])
        self.assertEqual(200, status)
        self.assertEqual(2, out["entries"])
        self.assertTrue(out["latest_at"], "nothing to say about when the last one was")
        self.assertEqual(1, out["storyboards"])

    def test_it_is_only_ever_about_you(self):
        """The line this feature lives on. A neighbour's writing must not reach it, or it
        has become a way of measuring other people.
        """
        owner, board = self.board("owner")
        neighbour = self.session("neighbour")
        self.db.grant(board, neighbour["user_id"], "contribute", owner["user_id"])
        self.submit(owner["token"], board, OK_JSON, story="mine")
        self.submit(neighbour["token"], board, OK_JSON, story="theirs")
        self.submit(neighbour["token"], board, OK_JSON, story="theirs again")

        self.assertEqual(1, self.record(owner["token"])[1]["entries"])
        self.assertEqual(2, self.record(neighbour["token"])[1]["entries"])

    def test_there_is_no_way_to_ask_about_somebody_else(self):
        """An endpoint that took a user id would be the thing CLAUDE.md rules out wearing a
        different name. It reads the token and nothing else, so a parameter changes nothing.
        """
        owner, board = self.board("owner")
        neighbour = self.session("neighbour")
        self.db.grant(board, neighbour["user_id"], "contribute", owner["user_id"])
        self.submit(neighbour["token"], board, OK_JSON, story="theirs")

        _, asked = self.get(f"/api/record?user_id={neighbour['user_id']}",
                            token=owner["token"])
        self.assertEqual(0, asked["entries"], "it answered about somebody else")

    def test_what_you_took_down_is_not_still_counted(self):
        """Otherwise the number is a score you cannot lower, which is the shape of the very
        thing that was ruled out.
        """
        who, board = self.board("mine")
        _, first = self.submit(who["token"], board, OK_JSON, story="on the fence")
        self.submit(who["token"], board, OK_JSON, story="and again")
        self.post("/api/entries/delete", {"entry_id": first["entry_id"]}, token=who["token"])
        self.assertEqual(1, self.record(who["token"])[1]["entries"])

    def test_it_needs_a_token(self):
        status, _ = self.record()
        self.assertEqual(401, status)


if __name__ == "__main__":
    unittest.main()
