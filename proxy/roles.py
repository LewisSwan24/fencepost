"""The three roles. Prompts always come from prompts/; the code keeps no second copy."""

import json
import re
import unicodedata
from pathlib import Path

from .model import UpstreamError

PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"
WRITER_KEYS = {"fun_facts", "tidied_story", "question"}
FACT_KEYS = {"text", "confidence"}
CONFIDENCE = {"established", "unverified"}
VERDICTS = {"ok", "review", "reject"}
LENGTH_FACTOR = 1.6

# The invented-number check from §3.4. Besides digits it catches English number words and
# time words: since v0.9 the assistant writes only English, and made-up detail almost
# always arrives as "two possums" or "last night".
NUMBER_WORDS = {
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "dozen", "couple", "yesterday", "tonight", "midnight", "noon",
}
TOKEN = re.compile(r"[0-9]+(?:[.:,][0-9]+)*|[^\W\d_]+", re.UNICODE)
CJK = re.compile(r"[\u3400-\u9fff]")
FENCE = re.compile(r"^`{3}(?:json)?|`{3}$", re.MULTILINE)


def load_prompt(role: str) -> tuple[str, str]:
    """Return (system_prompt, version). The GENERATED header line is not sent to the model."""
    version = (PROMPTS_DIR / "VERSION").read_text(encoding="utf-8").strip()
    blocks = []
    for name in ("shared", role):
        text = (PROMPTS_DIR / f"{name}.txt").read_text(encoding="utf-8")
        kept = [line for line in text.splitlines() if not line.startswith("# GENERATED")]
        blocks.append("\n".join(kept).strip())
    return "\n\n".join(blocks), version


def _wrap(fields: dict, body: str) -> str:
    lines = "\n".join(f"{k}: {v}" for k, v in fields.items())
    return f"<context>\n{lines}\n</context>\n\n<user_content>\n{body}\n</user_content>"


def _strip_fences(raw: str) -> str:
    return FENCE.sub("", raw.strip()).strip()


# ---------- Neighbour ----------

def _context_block(context: dict) -> str:
    """The Tier-1 context for one call, appended to the system prompt (prompts.md §2.2).

    It rides with the system message, not inside the user message, and the two reasons
    reinforce each other:

    - The gateway caches the input prefix in 128-token blocks and only pays out on
      identical bytes (measured 2026-09-18, qwen-integration.md §7). History is stored as
      the bare message and replayed exactly as it went out; a context block that existed
      only in the sent bytes of the last turn broke the prefix right there, so every turn
      re-read the whole conversation and only the static prompt was ever a cache hit.
    - A block rebuilt from the database on every call cannot go stale. A deleted or edited
      entry is gone from the next call with nothing stored that could carry it back
      (prompts.md §2.6.3) — no purge hook for any deletion path to forget. Storing the
      wrapped turn instead would need one on all three of them.

    The static prompt stays ahead of it: that part of the prefix is the same for every
    user and every call, so it is the part most likely to already be warm.
    """
    fields = {
        "species_selected": context["species_selected"],
        "storyboard_visible_to_this_user": str(context["storyboard_visible_to_this_user"]).lower(),
    }
    own = context.get("own_entries") or []
    if own:
        fields["own_entries"] = "".join(
            "\n- " + " | ".join(f"{k}: {e[k]}" for k in ("species", "fun_fact", "story") if e.get(k))
            for e in own
        )
    lines = "\n".join(f"{k}: {v}" for k, v in fields.items())
    return f"<context>\n{lines}\n</context>"


def _neighbour_user_content(message: str, image_b64=None):
    """The user turn is the bare message — exactly the bytes chat_messages stores, so the
    next call replays them unchanged and the prefix cache survives the turn boundary.
    A frame rides along for this call only and is never persisted (frames are not kept).
    """
    if not image_b64:
        return message
    return [
        {"type": "text", "text": message},
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
    ]


def _neighbour_system(context: dict) -> tuple[str, str]:
    prompt, version = load_prompt("neighbour")
    return f"{prompt}\n\n{_context_block(context)}", version


def neighbour(client, context: dict, history, message: str, image_b64=None) -> dict:
    system, version = _neighbour_system(context)
    return {"reply": client.call("neighbour", system,
                                 _neighbour_user_content(message, image_b64), history=history),
            "prompt_version": version}


class Stream:
    """Forward each delta while gathering the full text, so it can be stored at the end."""

    def __init__(self, prompt_version: str, chunks):
        self.prompt_version = prompt_version
        self.text = ""
        self._chunks = chunks

    def __iter__(self):
        for piece in self._chunks:
            self.text += piece
            yield piece


def neighbour_stream(client, context: dict, history, message: str, image_b64=None) -> Stream:
    system, version = _neighbour_system(context)
    return Stream(version, client.stream("neighbour", system,
                                         _neighbour_user_content(message, image_b64),
                                         history=history))


# ---------- Writer ----------

def writer(client, species_selected: str, story_draft: str) -> dict:
    system, version = load_prompt("writer")
    prompt = _wrap({"species_selected": species_selected}, f"story_draft: {story_draft}")
    for _ in range(2):                      # §3.4 item 5: retry a bad output once
        try:
            raw = client.call("writer", system, prompt)
        except UpstreamError:
            continue
        checked = validate_writer(raw, story_draft)
        if checked is not None:
            return {**checked, "prompt_version": version}
    # Silently skip when both attempts fail. The Writer is never a required step.
    return {"fun_facts": [], "tidied_story": None, "question": None, "skipped": True,
            "prompt_version": version}


def validate_writer(raw: str, original: str):
    """Validate against prompts.md §3.4. None means this output is unusable — retry."""
    try:
        data = json.loads(_strip_fences(raw))
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict) or set(data) != WRITER_KEYS:
        return None
    facts = data["fun_facts"]
    if not isinstance(facts, list):
        return None
    for fact in facts:
        if not isinstance(fact, dict) or set(fact) != FACT_KEYS or fact["confidence"] not in CONFIDENCE:
            return None
    tidied = data["tidied_story"]
    if isinstance(tidied, str) and not story_is_faithful(original, tidied):
        tidied = None                       # drop the tidy-up, keep the fun_facts
    return {"fun_facts": facts, "tidied_story": tidied, "question": data["question"], "skipped": False}


def story_is_faithful(original: str, tidied: str) -> bool:
    if _size(tidied) > _size(original) * LENGTH_FACTOR:
        return False
    return _figures(tidied) <= _figures(original)


def _figures(text: str) -> set:
    tokens = {t.lower() for t in TOKEN.findall(text)}
    return {t for t in tokens if t[0].isdigit() or t in NUMBER_WORDS}


def _size(text: str) -> int:
    return len(TOKEN.findall(text)) + len(CJK.findall(text))


# ---------- Screener ----------

def screener(client, species_selected: str, field: str, submission: str) -> dict:
    system, version = load_prompt("screener")
    prompt = _wrap({"species_selected": species_selected, "field": field}, submission)
    for _ in range(2):                      # retry once on bad JSON, then treat as a timeout
        try:
            raw = client.call("screener", system, prompt)
        except UpstreamError:
            continue
        parsed = parse_verdict(raw)
        if parsed is not None:
            return _language_floor(parsed, submission, version)
    # fail-open: a broken model should not stop somebody posting (prompts.md §5)
    return {"verdict": "review", "codes": [], "note": "", "fail_open": True,
            "downgraded_non_english": False, "prompt_version": version}


def parse_verdict(raw: str):
    try:
        data = json.loads(_strip_fences(raw))
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict) or data.get("verdict") not in VERDICTS:
        return None
    codes = data.get("codes") or []
    if not isinstance(codes, list) or any(not isinstance(c, str) for c in codes):
        return None
    return {"verdict": data["verdict"], "codes": codes, "note": str(data.get("note") or "")}


def _language_floor(result: dict, submission: str, version: str) -> dict:
    """operations.md §4.3: a non-English submission tops out at review, never reject."""
    downgraded = result["verdict"] == "reject" and looks_non_english(submission)
    if downgraded:
        result["verdict"] = "review"
    return {**result, "fail_open": False, "downgraded_non_english": downgraded,
            "prompt_version": version}


# Which alphabet a letter belongs to, straight out of the Unicode name. "LATIN SMALL LETTER
# O WITH CIRCUMFLEX AND TILDE" is LATIN; "CYRILLIC SMALL LETTER DZE" is CYRILLIC. No table to
# curate and nothing to keep up to date.
def _script(ch: str) -> str:
    try:
        return unicodedata.name(ch).split(" ", 1)[0]
    except ValueError:
        return "UNKNOWN"


# Function words: short, frequent, and almost impossible to write a sentence without — which
# is what makes them a language signal where a character ratio has none to give.
#
# Kept deliberately small. This is not language identification. It only has to answer "is
# there positive evidence of a language that is not English here", and it is allowed to say
# no. Every word is folded to plain ASCII before comparison, so "ngā" matches "nga" and "não"
# matches "nao" without the list carrying every accented spelling.
_ENGLISH_WORDS = {
    "the", "and", "but", "not", "was", "were", "are", "been", "have", "has", "had", "did",
    "does", "this", "that", "these", "those", "there", "here", "then", "when", "while",
    "with", "from", "for", "into", "onto", "off", "out", "about", "over", "under", "just",
    "very", "all", "some", "any", "one", "two", "his", "her", "him", "she", "they", "them",
    "their", "our", "your", "you", "its", "it", "on", "in", "at", "to", "of", "as", "by",
    "up", "my", "me", "we", "he", "is", "be", "an", "or", "if", "so", "no", "do", "a",
    "last", "night", "saw", "seen", "got", "went", "came", "looks", "looked", "back",
}

# Other Latin-script languages, by their own function words. Brisbane's languages first.
#
# The overlap with English is subtracted below rather than curated by hand, because the
# overlaps are exactly the ones that would be missed: "in" is German and Dutch, "is" is Dutch,
# "a" and "o" are Portuguese, "he" and "i" and "te" are te reo, "die" and "der" are German.
# Every one of those is also ordinary English, and counting them as evidence of another
# language would hand the floor to any English sentence at all — which is the hole found on
# 2026-09-16 wearing a new costume.
_OTHER_LANGUAGE_WORDS = {
    # French
    "le", "la", "les", "un", "une", "des", "du", "et", "est", "sur", "dans", "avec", "pour",
    "je", "il", "elle", "ils", "mon", "mes", "ce", "cette", "qui", "que", "pas", "nuit",
    "soir", "chez", "tres", "sont", "nous", "vous", "toit", "jardin",
    # Spanish
    "el", "los", "las", "unos", "unas", "una", "con", "por", "para", "mi", "su", "del", "al",
    "noche", "casa", "tejado", "anoche", "vi", "hay", "esta", "muy", "pero", "como",
    # Portuguese
    "um", "uma", "em", "nao", "meu", "minha", "da", "do", "dos", "das", "na", "ontem",
    "telhado", "quintal", "noite", "ele", "ela", "foi", "tem",
    # Italian
    "lo", "gli", "di", "che", "sono", "mia", "mio", "della", "notte", "tetto", "molto",
    # German and Dutch
    "der", "das", "ein", "eine", "und", "auf", "mit", "fur", "ich", "nicht", "dem", "den",
    "nacht", "dach", "het", "een", "niet", "ook", "maar", "zijn",
    # Indonesian and Malay
    "yang", "dan", "ke", "dari", "itu", "ini", "saya", "ada", "tidak", "sudah", "malam",
    "rumah", "atap", "tadi", "juga", "bisa",
    # Tagalog
    "ang", "sa", "ay", "mga", "ako", "niya", "may", "hindi", "kagabi", "bahay", "bubong",
    # te reo Māori
    "nga", "ki", "ko", "ahau", "runga", "taku", "tenei", "raua", "mai", "atu", "whare",
    "tera", "matou", "ratou", "taiapa",
    # Vietnamese, written without its diacritics
    "toi", "mot", "con", "tren", "hang", "rao", "nha", "khong", "duoc", "nguoi", "dem",
}
# Anything that is also ordinary English is evidence of nothing.
_OTHER_LANGUAGE_WORDS -= _ENGLISH_WORDS


def _fold(word: str) -> str:
    """Lower case with the accents taken off — for matching a word list, and nothing else.

    Never used for the script ratio. Stripping marks there would be the lookalike table's
    mistake all over again: it erodes the very signal it is meant to measure.
    """
    bare = "".join(c for c in unicodedata.normalize("NFD", word)
                   if not unicodedata.combining(c))
    return bare.casefold()


def _latin_but_not_english(text: str) -> bool:
    """Positive evidence of another language, for the ones a character ratio cannot see.

    The ratio below works on alphabet. Chinese, Greek, Cyrillic, Arabic and accented
    Vietnamese all clear ten percent and are recognised. French, Spanish, Portuguese,
    Indonesian, Tagalog and te reo Māori are written in the same alphabet as English and never
    come near it, so the floor simply did not apply to them and a submission in any of them
    could be refused outright. Measured 2026-09-17: six of six Latin-script samples invisible
    to the ratio, against three of three non-Latin ones recognised. That is the floor failing
    precisely the communities operations.md §4.3 exists to protect.

    This asks for evidence rather than for absence, and that difference is the whole design.
    "No English function words here" is just as true of `ksjdhf aslkdjf 99999`, and treating
    gibberish as a protected language would hand every abusive submission a way out of reject
    by writing it badly. So the test is: at least two words belonging to another language, and
    more of them than English ones.
    """
    words = [_fold(w) for w in re.findall(r"[^\W\d_]+", unicodedata.normalize("NFKC", text))]
    if len(words) < 3:
        # Too little to be evidence of anything either way. "Kia ora" earns no verdict.
        return False
    other = sum(1 for w in words if w in _OTHER_LANGUAGE_WORDS)
    english = sum(1 for w in words if w in _ENGLISH_WORDS)
    return other >= 2 and other > english


def looks_non_english(text: str) -> bool:
    """Only ever turns reject into review, so a wrong call always errs on the lenient side.

    The ratio is taken over letters that belong where they are. A letter from another
    alphabet sitting inside an otherwise Latin word is a disguise, not a language: swapping
    Cyrillic ѕ for s and І for I in sixty-one characters of English used to carry it over
    the line, and because tripping this floor makes a reject unreachable, anything the
    Screener refused could be published by anyone willing to change seven letters. It still
    read as plain English to everyone on the storyboard. Found by an adversarial review on
    2026-09-16, which got the red-line suite's own snake case published verbatim.

    Judged per word by which alphabet dominates it, rather than by a list of lookalikes. A
    list has to be complete to work and erodes the real signal when it is: folding the
    Cyrillic letters that happen to resemble Latin ones took a genuine Russian sentence from
    100% non-ASCII down to 50%, and a short one could have fallen under the line altogether —
    which is the floor failing the people it exists for, the more serious way to be wrong.

    Accented Latin is never touched. The ā in Ngā and the ố in Tối are LATIN by name as
    well as by eye, so they count exactly as they did before.
    """
    # NFKC first, so the fullwidth forms come back as the letters they are: unicodedata
    # names Ｔ "FULLWIDTH LATIN CAPITAL LETTER T", which reads as its own alphabet and let
    # Ｔｈｅ ｐｏｓｓｕｍ ｉｓ ｏｎ ｔｈｅ ｒｏｏｆ buy the same immunity. It is a compatibility fold, so it
    # leaves Cyrillic and Greek exactly where they are — which is what the script check
    # below is for — and leaves Vietnamese and te reo composed as they were written.
    kept = []
    for word in re.split(r"\s+", unicodedata.normalize("NFKC", text)):
        letters = [c for c in word if c.isalpha()]
        if not letters:
            continue
        scripts = [_script(c) for c in letters]
        latin = sum(1 for name in scripts if name == "LATIN")
        if latin and latin * 2 >= len(letters):
            # A Latin word. Whatever else wandered in is decoration on an English letter.
            kept.extend(c for c, name in zip(letters, scripts) if name == "LATIN")
        else:
            kept.extend(letters)
    if kept and sum(1 for c in kept if ord(c) > 127) / len(kept) > 0.1:
        return True
    # Two signals, not one. The ratio above reads alphabet and is blind to every language
    # that shares ours; the check below reads words and is blind to nothing else. Neither
    # covers the other, so the floor needs both — and because the floor only ever turns a
    # reject into a review, an OR here is the lenient direction by construction.
    return _latin_but_not_english(text)
