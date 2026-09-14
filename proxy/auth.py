"""Who is making this request.

prompts.md §2.6.1 wants every call to carry the requester's identity, so the proxy can
resolve their access before it assembles any context. The mechanism is an HMAC-signed
token, `<user_id>.<signature>`, keyed on FENCEPOST_TOKEN_SECRET.
No table, no dependency; without the secret a client cannot forge somebody else.
"""

import base64
import hashlib
import hmac
import secrets
import os


class AuthError(Exception):
    """Never say which part was wrong, or this becomes a cracking hint."""


def _secret() -> bytes:
    value = os.getenv("FENCEPOST_TOKEN_SECRET")
    if not value:
        raise AuthError("server_misconfigured")
    return value.encode()


def _sign(user_id: str) -> str:
    return hmac.new(_secret(), user_id.encode(), hashlib.sha256).hexdigest()


def new_share_token() -> str:
    """Plaintext share-link token. Returned once at issue time; only its hash is stored."""
    return secrets.token_urlsafe(32)


def hash_share_token(token: str) -> str:
    return hashlib.sha256((token or "").encode()).hexdigest()


def issue(user_id: str) -> str:
    return f"{user_id}.{_sign(user_id)}"


def verify(token: str) -> str:
    """Return the user_id. The signature check uses compare_digest, not ==."""
    user_id, dot, signature = (token or "").rpartition(".")
    if not dot or not user_id or not signature:
        raise AuthError("unauthorized")
    if not hmac.compare_digest(signature, _sign(user_id)):
        raise AuthError("unauthorized")
    return user_id


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
