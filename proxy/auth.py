"""Who is making this request.

prompts.md §2.6.1 wants every call to carry the requester's identity, so the proxy can
resolve their access before it assembles any context. The mechanism is an HMAC-signed
token, `<user_id>.<issued_at>.<signature>`, keyed on FENCEPOST_TOKEN_SECRET.
No table, no dependency; without the secret a client cannot forge somebody else.

The issue time is in the signed material, and it is what this module can decide on its own:
a token older than TOKEN_TTL_SECONDS is refused here. What it cannot decide is whether
somebody has since signed out — that is a fact about a row, not about the token — so
app._identify reads users.tokens_valid_from and compares. Two layers, and this is the one
that stays dependency-free. See data-model.md §1.2.
"""

import base64
import hashlib
import hmac
import secrets
import os
import time


class AuthError(Exception):
    """Never say which part was wrong, or this becomes a cracking hint."""


def _secret() -> bytes:
    value = os.getenv("FENCEPOST_TOKEN_SECRET")
    if not value:
        raise AuthError("server_misconfigured")
    return value.encode()


def _sign(material: str) -> str:
    return hmac.new(_secret(), material.encode(), hashlib.sha256).hexdigest()


def _material(user_id: str, stamp) -> str:
    """What a token's signature covers: a version tag, the user id and the issue time.

    The `v2|` is not decoration. The token before this one was `<user_id>.HMAC(user_id)`,
    and that verifier split on the LAST dot - so handed a new `<uid>.<ms>.<sig>` it read the
    user id as "<uid>.<ms>", signed that, and matched. A rollback of the API to a build from
    before 2026-09-18 would therefore have accepted every new token as a user id with no row:
    200 on reads, 500 on writes, and never the 401 that makes a client recover. The prefix
    is something the old format can never produce, so a rolled-back API refuses new tokens
    outright. Found by the pre-deploy review and reproduced there; not foreseen.
    """
    return f"v2|{user_id}.{stamp}"


# How long a token stays good for.
#
# Until 2026-09-18 a token was `<user_id>.<signature>` and nothing else, which made it a
# permanent bearer password equal to the user id: no issue time, so no expiry, and the only
# way to invalidate one was rotating FENCEPOST_TOKEN_SECRET, which signs out everybody at
# once. A signed-in account keeps its token in localStorage, so a captured one was permanent
# account access — and the Sign out button did not touch it, because it only cleared the
# browser. There is no password reset either, so nothing else revoked it.
#
# An issue time is the cheap half of the fix: it turns "compromised for ever" into
# "compromised until it expires", with no table and no extra read. Thirty days because the
# cost of getting it wrong is asymmetric — a guest is re-issued a token silently under open
# sign-up and notices nothing, while an account holder is signed out and, with no password
# reset in the product, a forgotten password means locked out. Long enough that nobody in a
# course-length project is interrupted; short enough that a leak is not for ever.
#
# The other half, revoking a token before it expires, is not here: it needs the database, and
# this module deliberately has no dependency on it. users.tokens_valid_from carries it and
# app._identify does the comparison. See data-model.md §1.2.
TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
# Stated once rather than multiplied at each comparison. The constant above is in the
# unit a person reasons in; this is the unit the token is in.
TTL_MS = TOKEN_TTL_SECONDS * 1000

# A token stamped in the future is refused, but not to the second. Several serverless
# instances issue these and one of them can be a little ahead, so a token minted on a fast
# instance would be refused by a slow one for as long as the drift lasts. Five minutes is
# more than any plausible drift and far less than the thirty days it would take to matter.
_CLOCK_SLACK_SECONDS = 5 * 60


def now_ms() -> int:
    """Milliseconds since the epoch, the unit tokens and the revocation cutoff share.

    An earlier version of this docstring said milliseconds "make them separate" - a token
    issued at T and a sign-out at T. That was a claim about the unit standing in for a claim
    about the clock, and the clock does not honour it: on Python 3.12 under Windows
    time.time() moves in 15.6 ms steps, and two serverless instances can disagree by more
    than that in either direction. So nothing relies on two readings of this clock being in
    order. What keeps sign-out correct is the rule in app.sign_out and app._mint - the cutoff
    is written past the token that asked, and a token is never issued below the cutoff -
    which holds whatever the resolution or the drift. Milliseconds are kept because they
    make ties rare, not because anything depends on ties being impossible.
    """
    return int(time.time() * 1000)


def new_share_token() -> str:
    """Plaintext share-link token. Returned once at issue time; only its hash is stored."""
    return secrets.token_urlsafe(32)


def hash_share_token(token: str) -> str:
    return hashlib.sha256((token or "").encode()).hexdigest()


def issue(user_id: str, issued_at: int = None) -> str:
    """`<user_id>.<issued_at>.<signature>`, the issue time inside the signed material.

    Milliseconds since the epoch as a plain integer, not one of the ISO stamps the rest of
    the schema uses: this string travels in an `Authorization: Bearer` header and RFC 6750's
    b64token grammar has no colon in it. Why milliseconds rather than seconds is in now_ms.
    `issued_at` is settable so a test can age a token without waiting.
    """
    stamp = now_ms() if issued_at is None else int(issued_at)
    return f"{user_id}.{stamp}.{_sign(_material(user_id, stamp))}"


def verify(token: str) -> tuple[str, int]:
    """Return (user_id, issued_at) — the issue time in milliseconds. The signature check uses compare_digest, not ==.

    Three things are refused and all of them say the same word outward: a token that is not
    three parts, one whose signature does not match, and one older than TOKEN_TTL_SECONDS.
    A token from the future is refused as well — a clock that far out is either wrong or
    somebody extending their own expiry, and neither should be served.

    The signature is checked before the age. The other order would tell a forger whether the
    timestamp they invented was in range, which is a free oracle on a field they control.
    """
    user_id, dot, rest = (token or "").partition(".")
    stamp, dot2, signature = rest.partition(".")
    if not dot or not dot2 or not user_id or not stamp or not signature:
        raise AuthError("unauthorized")
    # Bytes, not str. compare_digest raises TypeError on a str holding anything outside ASCII,
    # and the signature segment is whatever the Authorization header carried - http.server
    # decodes it as latin-1 - so "Bearer u1.1.<e-acute>" used to reach here and escape as a
    # 500, or drop an SSE stream with nothing written. Every refusal is meant to be one 401.
    presented = signature.encode("utf-8", "surrogatepass")
    if not hmac.compare_digest(presented, _sign(_material(user_id, stamp)).encode()):
        raise AuthError("unauthorized")
    # Only reachable with a valid signature, so this cannot be driven by a stranger — but a
    # ValueError escaping here would be a 500 where every other refusal is a 401, and the
    # rule is that nothing about why leaves the server.
    try:
        issued_at = int(stamp)
    except ValueError:
        raise AuthError("unauthorized") from None
    age_ms = now_ms() - issued_at
    if age_ms > TTL_MS or age_ms < -_CLOCK_SLACK_SECONDS * 1000:
        raise AuthError("unauthorized")
    return user_id, issued_at


# ---------- passwords ----------
#
# Real accounts, added 2026-09-15. Before this, identity was a handle and nothing else,
# which is the whole reason /api/session sits behind FENCEPOST_OPEN_SIGNUP: anybody could
# exchange anybody's handle for a token. A password is what lets that flag be closed for
# people who have registered, while the passwordless path stays for the demo identities and
# for the scripts that walk the deployment.
#
# hashlib.scrypt, out of the standard library. Not bcrypt or argon2: pyproject.toml is what
# Vercel installs, and pulling in a dependency with a C extension is a build risk taken on
# for something the runtime already has.

SCRYPT_N = 16384       # 128 * n * r is 16 MiB of memory per hash, and roughly 60ms of CPU
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_DKLEN = 32
_MAXMEM = 64 * 1024 * 1024   # stated rather than left to OpenSSL's default, which varies

_dummy_hash = None


def _dummy() -> str:
    """Something to verify against when there is no stored hash, so that "no such person"
    costs the same as "wrong password". Without it the response time answers the question
    the error message is carefully written not to: whether that handle exists.
    """
    global _dummy_hash
    if _dummy_hash is None:
        _dummy_hash = hash_password(secrets.token_urlsafe(16))
    return _dummy_hash


def _looks_like_hash(stored) -> bool:
    return isinstance(stored, str) and stored.startswith("scrypt$") and stored.count("$") == 5


def hash_password(password: str) -> str:
    """scrypt$n$r$p$salt$hash, self-describing so the parameters can change without a
    migration: rows written earlier still verify with the numbers they were written with,
    and only new rows use the new ones.
    """
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R,
                             p=SCRYPT_P, dklen=SCRYPT_DKLEN, maxmem=_MAXMEM)
    return "$".join(["scrypt", str(SCRYPT_N), str(SCRYPT_R), str(SCRYPT_P),
                     base64.b64encode(salt).decode(), base64.b64encode(derived).decode()])


def check_password(password: str, stored) -> bool:
    """False for a missing, empty or malformed hash, and it takes the same time either way.

    A NULL password_hash means "this identity cannot be signed into with a password", which
    is not the same as an empty password. Reading it as the latter would turn every demo
    identity, mel_k included, into an account anybody could open.
    """
    real = _looks_like_hash(stored)
    candidate = stored if real else _dummy()
    try:
        _, n, r, p, salt_b64, hash_b64 = candidate.split("$")
        expected = base64.b64decode(hash_b64)
        derived = hashlib.scrypt((password or "").encode(), salt=base64.b64decode(salt_b64),
                                 n=int(n), r=int(r), p=int(p), dklen=len(expected),
                                 maxmem=_MAXMEM)
    except (ValueError, TypeError):
        return False
    matched = hmac.compare_digest(derived, expected)
    return bool(real and matched)
