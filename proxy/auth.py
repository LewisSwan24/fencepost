"""Who is making this request.

prompts.md §2.6.1 wants every call to carry the requester's identity, so the proxy can
resolve their access before it assembles any context. The mechanism is an HMAC-signed
token, `<user_id>.<signature>`, keyed on FENCEPOST_TOKEN_SECRET.
No table, no dependency; without the secret a client cannot forge somebody else.
"""

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
