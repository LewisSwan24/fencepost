"""Short share codes (#54): three words that redeem a share link, said at the fence and typed.

    python tests/test_short_codes.py

A short code is a second way into the same share_links row, so most of what matters is that
it is held to everything a token already is (expiry, use limit, revocation, never stored in
the clear) and that it cannot be guessed at any useful rate.
"""

import json
import os
import re
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
os.environ.setdefault("FENCEPOST_TOKEN_SECRET", "test-secret")

import api.index as entry                                          # noqa: E402
import test_resources as base                                      # noqa: E402
from proxy import auth                                             # noqa: E402
from proxy.app import SHORT_CODE_DAYS, SHORT_CODE_MAX_DAYS         # noqa: E402
from proxy.db import SqliteCeilings                                # noqa: E402
from proxy.ports import CEILINGS                                   # noqa: E402
from proxy.words import WORDS                                      # noqa: E402

HOMOPHONES = {
    ("sea", "see"), ("tail", "tale"), ("flour", "flower"), ("pair", "pear"), ("hare", "hair"),
    ("bear", "bare"), ("deer", "dear"), ("plain", "plane"), ("sail", "sale"), ("steel", "steal"),
    ("meat", "meet"), ("rose", "rows"), ("knot", "not"), ("berry", "bury"), ("reed", "read"),
    ("board", "bored"), ("whale", "wail"), ("horse", "hoarse"), ("bean", "been"), ("creek", "creak"),
    ("pier", "peer"), ("thyme", "time"), ("yolk", "yoke"), ("wave", "waive"), ("ball", "bawl"),
}
VARIANT_SPELLINGS = {"color", "colour", "gray", "grey", "harbor", "harbour", "vapor", "vapour",
                     "yogurt", "yoghurt", "cozy", "cosy", "omelet", "chili", "fjord", "fiord"}


class TheWords(unittest.TestCase):
    def test_every_word_is_short_plain_and_listed_once(self):
        self.assertGreaterEqual(len(WORDS), 1000, "fewer words than the guessing odds assume")
        self.assertEqual(len(WORDS), len(set(WORDS)))
        for word in WORDS:
            self.assertRegex(word, r"^[a-z]{3,7}$")

    def test_no_word_is_heard_as_another(self):
        listed = set(WORDS)
        for pair in HOMOPHONES:
            self.assertFalse(set(pair) & listed, f"{pair} sound alike; a code read aloud is heard")
        self.assertFalse(VARIANT_SPELLINGS & listed, "a word with two spellings")

    def test_a_new_code_is_three_listed_words(self):
        for _ in range(50):
            code = auth.new_short_code()
            parts = code.split("-")
            self.assertEqual(3, len(parts))
            self.assertTrue(all(p in WORDS for p in parts))


class Normalising(unittest.TestCase):
    CODE = "wattle-moon-possum"

    def test_how_people_actually_type_it(self):
        for typed in ["wattle-moon-possum", "Wattle Moon Possum", " wattle.moon.possum ",
                      "WATTLE, MOON, POSSUM", "wattle moonpossum", "wattlemoonpossum"]:
            self.assertEqual(self.CODE, auth.normalise_short_code(typed), typed)

    def test_what_is_not_a_code(self):
        for typed in [None, 12, "", "wattle-moon", "wattle-moon-possum-gum", "wattle-moon-zzzz",
                      "x" * 65, "wattle-moon-possum" + " " * 60]:
            self.assertIsNone(auth.normalise_short_code(typed), repr(typed))

    def test_a_run_together_code_with_two_readings_is_refused(self):
        # Two splits of the same letters into listed words: guessing between them could
        # hand over somebody else's link, so neither is chosen.
        # Two listed words whose letters also split into two other listed words, then any
        # third word: (a, b, c) and (u, v, c) are both readings of the same letters.
        listed = set(WORDS)
        sample = next(((a, b) for a in WORDS for b in WORDS
                       for i in range(3, len(a + b) - 2)
                       if i != len(a) and (a + b)[:i] in listed and (a + b)[i:] in listed),
                      None)
        self.assertIsNotNone(sample, "no ambiguous run-together code exists to test with")
        a, b = sample
        c = WORDS[0]
        self.assertIsNone(auth.normalise_short_code(a + b + c))
        self.assertEqual(f"{a}-{b}-{c}", auth.normalise_short_code(f"{a} {b} {c}"))

    def test_the_hash_is_keyed(self):
        # A plain SHA-256 of one code in ~1.5 billion can be walked back from a copy of the
        # table in minutes; a keyed one cannot without the secret.
        import hashlib
        self.assertNotEqual(hashlib.sha256(self.CODE.encode()).hexdigest(),
                            auth.hash_short_code(self.CODE))
        with mock.patch.dict(os.environ, {"FENCEPOST_TOKEN_SECRET": "another"}):
            other = auth.hash_short_code(self.CODE)
        self.assertNotEqual(other, auth.hash_short_code(self.CODE))


class ShortCodes(base.Fixture):
    def link(self, token, storyboard_id, **over):
        body = {"storyboard_id": storyboard_id, "short_code": True}
        body.update(over)
        return self.post("/api/share-links", body, token=token)

    def redeem(self, code, who="neighbour-b"):
        return self.post("/api/share-links/redeem", {"code": code},
                         token=self.session(who)["token"])

    def test_issuing_hands_back_the_code_once_and_stores_only_a_keyed_hash(self):
        owner, board = self.board()
        status, issued = self.link(owner["token"], board)
        self.assertEqual(200, status)
        code = issued["short_code"]
        self.assertEqual(code, auth.normalise_short_code(code))
        row = self.db.share_link(issued["share_link_id"])
        self.assertEqual(auth.hash_short_code(code), row["code_hash"])
        rows = self.db.conn.execute("SELECT * FROM share_links").fetchall()
        self.assertNotIn(code, json.dumps([dict(r) for r in rows]))

        status, listing = self.get(f"/api/share-links?storyboard_id={board}", token=owner["token"])
        self.assertEqual(200, status)
        self.assertIs(True, listing["links"][0]["has_code"])
        self.assertNotIn(code, json.dumps(listing))

    def test_the_share_screen_holds_the_same_limits_as_the_server(self):
        """Two languages, two places. The screen hides the lifetimes a short code may not
        have and drops to the default; if either number parted from the server's, the
        screen would offer a chip the server refuses."""
        source = (ROOT / "web" / "lib" / "copy.js").read_text(encoding="utf-8")
        for name, value in (("SHORT_CODE_MAX_DAYS", SHORT_CODE_MAX_DAYS),
                            ("SHORT_CODE_DAYS", SHORT_CODE_DAYS)):
            found = re.findall(rf"export const {name} = (\d+);", source)
            self.assertEqual([str(value)], found, f"{name} differs between copy.js and app.py")

    def test_a_link_without_one_has_no_code(self):
        owner, board = self.board()
        _, issued = self.post("/api/share-links", {"storyboard_id": board}, token=owner["token"])
        self.assertNotIn("short_code", issued)
        self.assertIsNone(self.db.share_link(issued["share_link_id"])["code_hash"])
        _, listing = self.get(f"/api/share-links?storyboard_id={board}", token=owner["token"])
        self.assertIs(False, listing["links"][0]["has_code"])

    def test_a_code_lasts_a_day_unless_told_otherwise_and_a_week_at_most(self):
        owner, board = self.board()
        before = datetime.now(timezone.utc)
        _, issued = self.link(owner["token"], board)
        life = datetime.fromisoformat(issued["expires_at"]) - before
        self.assertAlmostEqual(SHORT_CODE_DAYS * 86400, life.total_seconds(), delta=5)
        status, _ = self.link(owner["token"], board, expires_in_days=SHORT_CODE_MAX_DAYS)
        self.assertEqual(200, status)
        status, payload = self.link(owner["token"], board, expires_in_days=SHORT_CODE_MAX_DAYS + 1)
        self.assertEqual(400, status)
        status, _ = self.link(owner["token"], board, short_code="yes")
        self.assertEqual(400, status)

    def test_the_code_redeems_at_the_links_level_however_it_is_typed(self):
        owner, board = self.board()
        _, issued = self.link(owner["token"], board, level="view")
        typed = issued["short_code"].replace("-", " ").upper()
        status, payload = self.redeem(typed)
        self.assertEqual(200, status, payload)
        self.assertEqual({"storyboard_id": board, "level": "view"}, payload)

    def test_the_token_of_the_same_link_still_works(self):
        owner, board = self.board()
        _, issued = self.link(owner["token"], board)
        status, _ = self.post("/api/share-links/redeem", {"token": issued["token"]},
                              token=self.session("by-qr")["token"])
        self.assertEqual(200, status)

    def test_a_code_is_held_to_its_links_revocation_expiry_and_use_limit(self):
        owner, board = self.board()
        _, once = self.link(owner["token"], board, max_uses=1)
        self.assertEqual(200, self.redeem(once["short_code"], "first")[0])
        status, payload = self.redeem(once["short_code"], "second")
        self.assertEqual((403, "link_used_up"), (status, payload["error"]["code"]))

        _, off = self.link(owner["token"], board)
        self.post("/api/share-links/revoke", {"share_link_id": off["share_link_id"]},
                  token=owner["token"])
        status, payload = self.redeem(off["short_code"], "third")
        self.assertEqual((403, "link_revoked"), (status, payload["error"]["code"]))

        _, old = self.link(owner["token"], board)
        self.db.conn.execute("UPDATE share_links SET expires_at = '2020-01-01T00:00:00+00:00' "
                             "WHERE id = ?", (old["share_link_id"],))
        self.db.conn.commit()
        status, payload = self.redeem(old["short_code"], "fourth")
        self.assertEqual((403, "link_expired"), (status, payload["error"]["code"]))

    def test_a_wrong_or_malformed_code_is_the_same_404(self):
        owner, board = self.board()
        self.link(owner["token"], board)
        for code in ["wattle-moon-possum", "not a code", 42, ["wattle"]]:
            status, payload = self.redeem(code, "guesser")
            self.assertEqual((404, "invalid_link"), (status, payload["error"]["code"]), repr(code))

    def test_issuing_steps_round_a_code_some_row_already_holds(self):
        owner, board = self.board()
        _, first = self.link(owner["token"], board)
        taken = first["short_code"]
        fresh = "wattle-moon-possum" if taken != "wattle-moon-possum" else "gum-moon-possum"
        with mock.patch.object(auth, "new_short_code", side_effect=[taken, fresh]):
            status, second = self.link(owner["token"], board)
        self.assertEqual(200, status)
        self.assertEqual(fresh, second["short_code"])


class GuessingIsBounded(base.Fixture):
    """CEILINGS['code'] and ['code_user']: every attempt counts, hit or miss."""

    def setUp(self):
        super().setUp()
        entry._DEPS.ceilings = SqliteCeilings(self.db)

    def attempt(self, who):
        return self.post("/api/share-links/redeem", {"code": "wattle-moon-possum"},
                         token=who["token"])

    def test_one_caller_is_capped(self):
        with mock.patch.dict(CEILINGS, {"code_user": (2, 3600), "code": (100, 3600)}):
            guesser = self.session("guesser")
            self.assertEqual(404, self.attempt(guesser)[0])
            self.assertEqual(404, self.attempt(guesser)[0])
            status, payload = self.attempt(guesser)
        self.assertEqual(429, status)
        self.assertEqual("code", payload["error"]["scope"])

    def test_fresh_identities_do_not_get_round_the_shared_ceiling(self):
        # Open sign-up mints a user per handle, so the per-user cap alone bounds nothing.
        with mock.patch.dict(CEILINGS, {"code_user": (100, 3600), "code": (3, 3600)}):
            for n in range(3):
                self.assertEqual(404, self.attempt(self.session(f"guest-{n}"))[0])
            status, _ = self.attempt(self.session("guest-new"))
        self.assertEqual(429, status)

    def test_a_right_code_counts_as_well(self):
        owner, board = self.board()
        _, issued = self.post("/api/share-links", {"storyboard_id": board, "short_code": True},
                              token=owner["token"])
        with mock.patch.dict(CEILINGS, {"code_user": (100, 3600), "code": (1, 3600)}):
            status, _ = self.post("/api/share-links/redeem", {"code": issued["short_code"]},
                                  token=self.session("first")["token"])
            self.assertEqual(200, status)
            status, _ = self.attempt(self.session("second"))
        self.assertEqual(429, status)

    def test_a_token_redemption_is_not_counted(self):
        owner, board = self.board()
        _, issued = self.post("/api/share-links", {"storyboard_id": board}, token=owner["token"])
        with mock.patch.dict(CEILINGS, {"code_user": (1, 3600), "code": (1, 3600)}):
            who = self.session("by-token")
            for _ in range(3):
                status, _ = self.post("/api/share-links/redeem", {"token": issued["token"]},
                                      token=who["token"])
                self.assertEqual(200, status)


if __name__ == "__main__":
    unittest.main()
