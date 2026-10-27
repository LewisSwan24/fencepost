"""scripts/issue_booth_screen.py against a fake API: what it writes, what it refuses, and
that no token ever reaches the terminal. Does not touch the network."""

import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import issue_booth_screen as script  # noqa: E402

OWNER_TOKEN = "tok-owner-SECRET"
SCREEN_TOKEN = "tok-screen-SECRET"
JOIN = "share-contribute-SECRET"
VIEW = "share-view-SECRET"


class FakeApi:
    def __init__(self, board_status="active", level="reshare", grant=None, timeline=200):
        self.calls = []
        self.board_status, self.level = board_status, level
        self.grant = grant or {}
        self.timeline = timeline
        self.sessions = 0

    def __call__(self, base, path, token=None, body=None):
        self.calls.append((path, token, body))
        if path == "/api/session":
            self.sessions += 1
            if body["handle"] == "owner":
                return 200, {"token": OWNER_TOKEN}
            if body["handle"].startswith("booth-screen-"):
                return 200, {"token": SCREEN_TOKEN}
            return 200, {"token": "tok-probe-SECRET"}
        if path == "/api/dashboard":
            return 200, {"active": [{"id": "sb_booth", "status": self.board_status,
                                     "level": self.level, "title": "Booth board"}]}
        if path == "/api/share-links":
            plain = JOIN if body["level"] == "contribute" else VIEW
            return 200, {"token": plain, "share_link_id": "sl_" + body["level"],
                         "level": body["level"], "expires_at": "2026-10-31T00:00:00+00:00"}
        if path == "/api/share-links/redeem":
            level = "contribute" if body["token"] == JOIN else "view"
            return 200, {"storyboard_id": "sb_booth", "level": self.grant.get(level, level)}
        if path.startswith("/api/timeline"):
            return self.timeline, {"entries": [{"id": "e1"}], "next": None}
        raise AssertionError("unexpected " + path)


class IssueBoothScreen(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.out = Path(self.dir.name) / ".env.production.local"
        self.original = script.send

    def tearDown(self):
        script.send = self.original
        self.dir.cleanup()

    def run_script(self, api, *extra):
        script.send = api
        printed = io.StringIO()
        code = 0
        with contextlib.redirect_stdout(printed):
            try:
                script.main(["https://api.test", "--owner", "owner", "--storyboard", "sb_booth",
                             "--web", "https://web.test/", "--out", str(self.out), *extra])
            except SystemExit as exit_:
                code = exit_.code
        return code, printed.getvalue()

    def test_writes_every_setting_and_prints_no_token(self):
        api = FakeApi()
        code, printed = self.run_script(api)
        self.assertEqual(0, code, printed)
        written = self.out.read_text(encoding="utf-8")
        self.assertIn(f"NEXT_PUBLIC_WN_BOOTH_JOIN_URL=https://web.test/s/{JOIN}\n", written)
        self.assertIn("FENCEPOST_API=https://api.test\n", written)
        self.assertIn("FENCEPOST_BOOTH_STORYBOARD=sb_booth\n", written)
        self.assertIn(f"FENCEPOST_BOOTH_TOKEN={SCREEN_TOKEN}\n", written)
        self.assertNotIn("SECRET", printed)

    def test_the_screen_is_a_view_member_and_the_qr_is_contribute(self):
        api = FakeApi()
        self.run_script(api)
        issued = [body["level"] for path, _, body in api.calls if path == "/api/share-links"]
        self.assertEqual(["contribute", "view"], issued)
        days = {body["expires_in_days"] for path, _, body in api.calls
                if path == "/api/share-links"}
        self.assertEqual({3}, days)
        reads = [token for path, token, _ in api.calls if path.startswith("/api/timeline")]
        self.assertEqual([SCREEN_TOKEN], reads, "the timeline is read as the screen")

    def test_a_link_that_grants_the_wrong_level_writes_nothing(self):
        code, printed = self.run_script(FakeApi(grant={"view": "contribute"}))
        self.assertEqual(1, code)
        self.assertFalse(self.out.exists())
        self.assertNotIn("SECRET", printed)

    def test_a_screen_that_cannot_read_writes_nothing(self):
        code, _ = self.run_script(FakeApi(timeline=403))
        self.assertEqual(1, code)
        self.assertFalse(self.out.exists())

    def test_an_existing_file_is_never_overwritten(self):
        self.out.write_text("FENCEPOST_BOOTH_TOKEN=keep-me\n", encoding="utf-8")
        api = FakeApi()
        code, _ = self.run_script(api)
        self.assertEqual(1, code)
        self.assertEqual("FENCEPOST_BOOTH_TOKEN=keep-me\n", self.out.read_text(encoding="utf-8"))
        self.assertEqual([], api.calls, "refused before asking the server anything")

    def test_without_reshare_nothing_is_issued(self):
        api = FakeApi(level="contribute")
        code, _ = self.run_script(api)
        self.assertEqual(1, code)
        self.assertFalse(any(path == "/api/share-links" for path, _, _ in api.calls))

    def test_a_closed_storyboard_is_refused(self):
        code, _ = self.run_script(FakeApi(board_status="readonly"))
        self.assertEqual(1, code)
        self.assertFalse(self.out.exists())


if __name__ == "__main__":
    unittest.main()
