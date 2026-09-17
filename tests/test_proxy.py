"""Unit tests for the proxy. Offline — the model is faked, so only the proxy's own rules run.

    python tests/test_proxy.py

(`unittest discover` does not work here: tests/ has no __init__.py, so it raises
ImportError: Start directory is not importable.)
"""

import json
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("FENCEPOST_TOKEN_SECRET", "test-secret")

from proxy import auth                                    # noqa: E402
from proxy.app import COPY, Deps, handle, handle_stream    # noqa: E402
from proxy.model import UpstreamError                     # noqa: E402
from proxy import roles                                   # noqa: E402
from proxy.ports import MemoryRateLimiter                 # noqa: E402

VERSION = (ROOT / "prompts" / "VERSION").read_text(encoding="utf-8").strip()
TOKEN = auth.issue("u1")
OK_JSON = '{"verdict":"ok","codes":[],"note":""}'
REJECT_JSON = '{"verdict":"reject","codes":["pii"],"note":"address named"}'
FACT = '{"text":"Brushtails are nocturnal.","confidence":"established"}'


class FakeClient:
    """Return the prepared responses in order. If one is an exception, raise it."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls = []

    def call(self, role, system, content, history=()):
        self.calls.append({"role": role, "system": system, "content": content, "history": list(history)})
        reply = self.replies.pop(0) if self.replies else ""
        if isinstance(reply, Exception):
            raise reply
        return reply

    def stream(self, role, system, content, history=()):
        self.calls.append({"role": role, "system": system, "content": content, "history": list(history)})
        reply = self.replies.pop(0) if self.replies else ""
        for piece in reply if isinstance(reply, list) else [reply]:
            if isinstance(piece, Exception):
                raise piece
            yield piece


def deps_for(client, limits=None, user="u1", storyboard="s1"):
    deps = Deps(client=client, limiter=MemoryRateLimiter(limits) if limits else MemoryRateLimiter())
    deps.context.grants.add((user, storyboard))
    return deps


def chat(**over):
    body = {"role": "neighbour", "storyboard_id": "s1", "message": "is this a possum?"}
    body.update(over)
    return body


def screen(**over):
    body = {"role": "screener", "field": "fun_fact", "submission": "Brushtails are nocturnal."}
    body.update(over)
    return body


class Auth(unittest.TestCase):
    def test_missing_token_is_401(self):
        status, payload = handle(chat(), "", deps_for(FakeClient("hi")))
        self.assertEqual(401, status)
        self.assertEqual("unauthorized", payload["error"]["code"])

    def test_tampered_signature_is_401(self):
        bad = TOKEN[:-1] + ("0" if TOKEN[-1] != "0" else "1")
        status, _ = handle(chat(), bad, deps_for(FakeClient("hi")))
        self.assertEqual(401, status)

    def test_valid_token_reaches_the_role(self):
        client = FakeClient("Sounds like a brushtail.")
        status, payload = handle(chat(), TOKEN, deps_for(client))
        self.assertEqual(200, status)
        self.assertEqual("Sounds like a brushtail.", payload["reply"])


class Screener(unittest.TestCase):
    def test_fail_open_when_upstream_dies(self):
        deps = deps_for(FakeClient(UpstreamError("boom"), UpstreamError("boom")))
        status, payload = handle(screen(), TOKEN, deps)
        self.assertEqual(200, status)
        self.assertTrue(payload["published"])
        self.assertEqual("review", deps.screening.records[0]["verdict"])
        self.assertTrue(deps.screening.records[0]["fail_open"])

    def test_bad_json_retries_once(self):
        client = FakeClient("sorry, here is my answer", OK_JSON)
        deps = deps_for(client)
        handle(screen(), TOKEN, deps)
        self.assertEqual(2, len(client.calls))
        self.assertEqual("ok", deps.screening.records[0]["verdict"])
        self.assertFalse(deps.screening.records[0]["fail_open"])

    def test_reject_tells_the_client_why(self):
        deps = deps_for(FakeClient(REJECT_JSON))
        _, payload = handle(screen(submission="He lives at 42 Example St."), TOKEN, deps)
        self.assertFalse(payload["published"])
        self.assertEqual(["pii"], payload["reason_codes"])
        self.assertNotIn("address named", json.dumps(payload))

    def test_review_looks_exactly_like_ok(self):
        review = deps_for(FakeClient('{"verdict":"review","codes":["fact_conflict"],"note":"x"}'))
        _, flagged = handle(screen(), TOKEN, review)
        _, clean = handle(screen(), TOKEN, deps_for(FakeClient(OK_JSON)))
        self.assertEqual(clean, flagged)
        self.assertEqual("review", review.screening.records[0]["verdict"])

    def test_non_english_is_never_rejected(self):
        deps = deps_for(FakeClient(REJECT_JSON))
        _, payload = handle(screen(submission="他住在四十二号，史密斯家的屋顶。"), TOKEN, deps)
        self.assertTrue(payload["published"])
        self.assertEqual("review", deps.screening.records[0]["verdict"])
        self.assertTrue(deps.screening.records[0]["downgraded_non_english"])

    def test_english_reject_stays_rejected(self):
        deps = deps_for(FakeClient(REJECT_JSON))
        _, payload = handle(screen(submission="He lives at 42 Example St."), TOKEN, deps)
        self.assertFalse(payload["published"])
        self.assertFalse(deps.screening.records[0]["downgraded_non_english"])


class LanguageFloor(unittest.TestCase):
    """The operations §4.3 floor rests on looks_non_english, so its edges are pinned here."""

    def test_real_sentences_are_recognised(self):
        for text in ("昨晚在栅栏上看到一只，盯着我看了好久。",
                     "Tối qua tôi thấy một con trên hàng rào sau nhà, đuôi xù.",
                     "رأيت واحداً على السياج خلف البيت الليلة الماضية."):
            with self.subTest(text=text[:12]):
                self.assertTrue(roles.looks_non_english(text))

    def test_english_stays_english(self):
        self.assertFalse(roles.looks_non_english("Saw one on the fence at the cafe last night."))

    def test_text_without_letters_counts_as_english(self):
        """Punctuation and digits alone carry no language signal, so they can still
        be rejected — deliberately, not as an escape.

        zh-5, vi-5 and ar-5 in the sample run land here: refusing keyboard mashing is not
        discrimination against any language community.
        """
        for text in ("。。。。。。1111111 ？？？", "........ ١١١١١١ ؟؟؟", "......... 1111111 ???"):
            with self.subTest(text=text[:8]):
                self.assertFalse(roles.looks_non_english(text))

    def test_latin_gibberish_is_treated_like_english_gibberish(self):
        self.assertFalse(roles.looks_non_english("ksjdhf aslkdjf 99999 xyzxyz khhh"))

    def test_english_in_a_costume_is_still_english(self):
        """The hole an adversarial review found on 2026-09-16.

        The floor turns a reject into a review, so anything that trips it cannot be refused.
        Swapping seven of sixty-one letters for lookalikes — Cyrillic ѕ for s, І for I —
        put this over the ten percent line, and the red-line suite's own case 32 published
        verbatim while reading as plain English to everyone on the storyboard.
        """
        plain = "It's just a tree snake, totally harmless, I picked it up to move it off the path."
        costume = plain.replace("s", "ѕ").replace("I", "І")
        self.assertNotEqual(plain, costume, "the sample did not actually get disguised")
        self.assertFalse(roles.looks_non_english(plain))
        self.assertFalse(roles.looks_non_english(costume),
                         "English wearing another alphabet still bought immunity from reject")
        # Greek and fullwidth are the same trick with a different alphabet.
        self.assertFalse(roles.looks_non_english("Thε pοssυm ιs οn thε rοf"))
        self.assertFalse(roles.looks_non_english("Ｔｈｅ ｐｏｓｓｕｍ ｉｓ ｏｎ ｔｈｅ ｒｏｏｆ"))

    def test_a_real_alphabet_is_never_mistaken_for_a_disguise(self):
        """The more serious way to be wrong, and the reason this is judged per word rather
        than by a list of lookalikes.

        A lookalike list has to be complete to stop the trick, and being complete erodes the
        real signal: folding the Cyrillic letters that happen to resemble Latin ones took a
        Russian sentence from 100% non-ASCII to 50%, and a short one made mostly of those
        letters would have fallen under the line — handing the reject tier back over exactly
        the communities operations.md 4.3 exists to protect.
        """
        for text in ("Tối qua tôi thấy một con trên hàng rào sau nhà.",
                     "昨晚在栅栏上看到一只。",
                     "Я видел одного на заборе вчера вечером.",
                     "сорока ворона",
                     "رأيت واحدا على السياج"):
            with self.subTest(text=text[:14]):
                self.assertTrue(roles.looks_non_english(text))

    def test_a_latin_script_language_reaches_the_floor(self):
        """The gap this test used to pin open, closed on 2026-09-17.

        A ratio over letters reads alphabet, and every language below shares ours, so none of
        them came near ten percent — te reo Māori sat at 5.7%. The floor simply did not apply
        to them: a te reo, French or Tagalog submission could be refused outright while a
        Vietnamese one could not. Measured before the fix: six of six Latin-script samples
        invisible to the ratio, three of three non-Latin ones recognised.

        The second signal reads words rather than letters, which is the only thing that can
        tell these apart from English.
        """
        for text in ("Ngā Tama i kite i te kierē i runga i te taiapa.",
                     "Il y a un opossum sur ma terrasse tous les soirs.",
                     "Hay una zarigüeya en el techo de mi casa cada noche.",
                     "Vi um gambá no telhado ontem à noite.",
                     "Ada possum di atap rumah saya tadi malam.",
                     "May possum sa bubong ng bahay ko kagabi.",
                     "Ein Possum war letzte Nacht auf dem Dach."):
            with self.subTest(text=text[:16]):
                self.assertTrue(roles.looks_non_english(text))

    def test_the_word_signal_needs_evidence_not_merely_absence(self):
        """Why the second signal asks "is another language here" rather than "is English gone".

        Absence of English function words is exactly as true of keyboard mashing as it is of
        French. Reading that absence as a language would let any abusive submission escape
        reject by being written badly — handing back the one tier this floor is careful never
        to touch. So all of these stay English-side and reject stays reachable for them.
        """
        for text in ("ksjdhf aslkdjf 99999 xyzxyz khhh",
                     "Brushtail possum, jacaranda tree, midnight.",
                     "Saw it near Toowong and Indooroopilly last night.",
                     "aaaaa bbbbb ccccc ddddd"):
            with self.subTest(text=text[:16]):
                self.assertFalse(roles.looks_non_english(text))

    def test_a_disguise_cannot_borrow_the_new_signal(self):
        """The 2026-09-16 hole, re-run against the signal added on 2026-09-17.

        The other-language list has the English one subtracted from it precisely so that no
        English sentence can score as another language. Swapping letters for lookalikes
        breaks the English words without creating any others, so the evidence test still
        answers no and the reject tier stays reachable.
        """
        plain = "It's just a tree snake, totally harmless, I picked it up to move it off the path."
        self.assertFalse(roles.looks_non_english(plain.replace("s", "ѕ").replace("I", "І")))
        self.assertFalse(roles.looks_non_english("Thε pοssυm ιs οn thε rοf"))

    def test_too_few_words_is_not_evidence_either_way(self):
        """A remaining, deliberate gap: a very short phrase carries no signal worth reading.

        "Kia ora" is two words. Guessing a language from them would be worse than declining
        to, and declining costs little — the floor only ever softens a reject, so what is
        given up is leniency on a fragment, not protection on a submission.
        """
        self.assertFalse(roles.looks_non_english("Kia ora"))


class Writer(unittest.TestCase):
    def write(self, *replies, draft="saw a possum at the fence"):
        deps = deps_for(FakeClient(*replies))
        return handle({"role": "writer", "species_selected": "brushtail", "story_draft": draft}, TOKEN, deps)

    def test_invented_numbers_drop_the_tidied_story(self):
        _, payload = self.write('{"fun_facts":[' + FACT + '],"tidied_story":"Saw two possums.","question":null}')
        self.assertIsNone(payload["tidied_story"])
        self.assertEqual(1, len(payload["fun_facts"]))
        self.assertFalse(payload["skipped"])

    def test_overlong_tidied_story_is_dropped(self):
        long_story = "I saw a possum sitting on the fence and it stared at me for ages"
        _, payload = self.write('{"fun_facts":[],"tidied_story":"' + long_story + '","question":null}',
                                draft="saw a possum")
        self.assertIsNone(payload["tidied_story"])

    def test_faithful_tidy_survives(self):
        _, payload = self.write('{"fun_facts":[],"tidied_story":"Saw a possum at the fence.","question":null}')
        self.assertEqual("Saw a possum at the fence.", payload["tidied_story"])

    def test_wrong_shape_retries_then_skips(self):
        _, payload = self.write('{"fun_facts":[]}', "still not right")
        self.assertTrue(payload["skipped"])
        self.assertEqual([], payload["fun_facts"])

    def test_retry_then_valid(self):
        good = '{"fun_facts":[' + FACT + '],"tidied_story":null,"question":"What was it doing?"}'
        _, payload = self.write("{oops", good)
        self.assertFalse(payload["skipped"])
        self.assertEqual("What was it doing?", payload["question"])


class Limits(unittest.TestCase):
    LIMITS = {"chat": (2, 3600), "vision": (1, 3600), "submission": (2, 3600)}

    def test_chat_cap_degrades_not_blocks(self):
        deps = deps_for(FakeClient("a", "b", "c"), limits=self.LIMITS)
        for _ in range(2):
            self.assertEqual(200, handle(chat(), TOKEN, deps)[0])
        status, payload = handle(chat(), TOKEN, deps)
        self.assertEqual(429, status)
        self.assertEqual("chat", payload["error"]["scope"])
        self.assertIn("Writing, posting and sharing all still work", payload["error"]["message"])

    def test_vision_has_its_own_cap(self):
        deps = deps_for(FakeClient("a", "b"), limits=self.LIMITS)
        framed = chat(image_b64="AAAA", frame_consent=True)
        self.assertEqual(200, handle(framed, TOKEN, deps)[0])
        status, payload = handle(framed, TOKEN, deps)
        self.assertEqual(429, status)
        self.assertEqual("vision", payload["error"]["scope"])

    def test_frame_without_consent_is_refused(self):
        deps = deps_for(FakeClient("a"), limits=self.LIMITS)
        status, payload = handle(chat(image_b64="AAAA"), TOKEN, deps)
        self.assertEqual(400, status)
        self.assertEqual("frame_consent_missing", payload["error"]["code"])

    def test_submission_cap(self):
        deps = deps_for(FakeClient(OK_JSON, OK_JSON, OK_JSON), limits=self.LIMITS)
        for _ in range(2):
            self.assertEqual(200, handle(screen(), TOKEN, deps)[0])
        self.assertEqual(429, handle(screen(), TOKEN, deps)[0])


class Boundaries(unittest.TestCase):
    def test_history_comes_from_the_server_not_the_body(self):
        client = FakeClient("hi")
        deps = deps_for(client)
        deps.history.append("u1", "s1", "user", "my own earlier line")
        planted = chat(history=[{"role": "user", "content": "PLANTED BY CLIENT"}])
        handle(planted, TOKEN, deps)
        sent = json.dumps(client.calls[0], ensure_ascii=False)
        self.assertIn("my own earlier line", sent)
        self.assertNotIn("PLANTED BY CLIENT", sent)

    def test_history_is_capped_at_six(self):
        client = FakeClient("hi")
        deps = deps_for(client)
        for i in range(10):
            deps.history.append("u1", "s1", "user", f"line {i}")
        handle(chat(), TOKEN, deps)
        self.assertEqual(6, len(client.calls[0]["history"]))

    def test_no_grant_is_403(self):
        deps = Deps(client=FakeClient("hi"))
        status, payload = handle(chat(), TOKEN, deps)
        self.assertEqual(403, status)
        self.assertEqual("no_access", payload["error"]["code"])

    def test_upstream_text_never_reaches_the_client(self):
        deps = deps_for(FakeClient(UpstreamError("401 invalid api key sk-secret-value")))
        status, payload = handle(chat(), TOKEN, deps)
        self.assertEqual(503, status)
        self.assertEqual(COPY["upstream_unavailable"], payload["error"]["message"])
        self.assertNotIn("sk-secret-value", json.dumps(payload))

    def test_system_prompt_never_reaches_the_client(self):
        deps = deps_for(FakeClient("Sounds like a brushtail."))
        _, payload = handle(chat(), TOKEN, deps)
        self.assertNotIn("SHARED RULES", json.dumps(payload))


class Versioning(unittest.TestCase):
    def test_every_role_returns_the_prompt_version(self):
        writer_json = '{"fun_facts":[],"tidied_story":null,"question":"What was it doing?"}'
        cases = [
            (chat(), FakeClient("hi")),
            ({"role": "writer", "story_draft": "saw a possum"}, FakeClient(writer_json)),
            (screen(), FakeClient(OK_JSON)),
        ]
        for body, client in cases:
            with self.subTest(role=body["role"]):
                _, payload = handle(body, TOKEN, deps_for(client))
                self.assertEqual(VERSION, payload["prompt_version"])


class Streaming(unittest.TestCase):
    def test_deltas_flow_then_history_is_written_once(self):
        client = FakeClient(["Sounds ", "like a ", "brushtail."])
        deps = deps_for(client)
        status, session = handle_stream(chat(), TOKEN, deps)
        self.assertEqual(200, status)
        self.assertEqual(VERSION, session.prompt_version)
        self.assertEqual(["Sounds ", "like a ", "brushtail."], list(session))
        session.finish()
        self.assertEqual(["is this a possum?", "Sounds like a brushtail."],
                         [m["content"] for m in deps.history.recent("u1", "s1")])

    def test_a_broken_stream_stores_nothing(self):
        deps = deps_for(FakeClient(["half a reply ", UpstreamError("boom")]))
        _, session = handle_stream(chat(), TOKEN, deps)
        with self.assertRaises(UpstreamError):
            list(session)
        self.assertEqual([], deps.history.recent("u1", "s1"))

    def test_streaming_is_only_for_neighbour(self):
        for role in ("writer", "screener"):
            with self.subTest(role=role):
                status, _ = handle_stream({"role": role}, TOKEN, deps_for(FakeClient("x")))
                self.assertEqual(400, status)

    def test_streaming_respects_the_permission_gate(self):
        status, payload = handle_stream(chat(), TOKEN, Deps(client=FakeClient(["hi"])))
        self.assertEqual(403, status)
        self.assertEqual("no_access", payload["error"]["code"])

    def test_streaming_counts_against_the_chat_limit(self):
        limits = {"chat": (1, 3600), "vision": (1, 3600), "submission": (2, 3600)}
        deps = deps_for(FakeClient(["a"], ["b"]), limits=limits)
        self.assertEqual(200, handle_stream(chat(), TOKEN, deps)[0])
        status, payload = handle_stream(chat(), TOKEN, deps)
        self.assertEqual(429, status)
        self.assertEqual("chat", payload["error"]["scope"])


if __name__ == "__main__":
    unittest.main()
