"""请求者身分。

prompts.md §2.6.1 要求每次调用都带请求者身分，由代理解析权限后才拼上下文。
做法是 HMAC 签名令牌 `<user_id>.<签名>`，密钥在 FENCEPOST_TOKEN_SECRET。
不建表、不引依赖；客户端没有密钥就伪造不出别人的身分。
"""

import hashlib
import hmac
import os


class AuthError(Exception):
    """一律不解释哪里不对，免得成为爆破提示。"""


def _secret() -> bytes:
    value = os.getenv("FENCEPOST_TOKEN_SECRET")
    if not value:
        raise AuthError("server_misconfigured")
    return value.encode()


def _sign(user_id: str) -> str:
    return hmac.new(_secret(), user_id.encode(), hashlib.sha256).hexdigest()


def issue(user_id: str) -> str:
    return f"{user_id}.{_sign(user_id)}"


def verify(token: str) -> str:
    """返回 user_id。签名比对走 compare_digest，不用 ==。"""
    user_id, dot, signature = (token or "").rpartition(".")
    if not dot or not user_id or not signature:
        raise AuthError("unauthorized")
    if not hmac.compare_digest(signature, _sign(user_id)):
        raise AuthError("unauthorized")
    return user_id
