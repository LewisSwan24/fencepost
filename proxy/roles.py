"""三个角色。提示词一律从 prompts/ 读，代码里不留第二份。"""

import json
import re
from pathlib import Path

from .model import UpstreamError

PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"
WRITER_KEYS = {"fun_facts", "tidied_story", "question"}
FACT_KEYS = {"text", "confidence"}
CONFIDENCE = {"established", "unverified"}
VERDICTS = {"ok", "review", "reject"}
LENGTH_FACTOR = 1.6

# §3.4 的数字注入检查。除阿拉伯数字外也拦英文数词与时间词：v0.9 起助手只写英文，
# 编造细节最常见的形态就是 two possums、last night 这类。
NUMBER_WORDS = {
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "dozen", "couple", "yesterday", "tonight", "midnight", "noon",
}
TOKEN = re.compile(r"[0-9]+(?:[.:,][0-9]+)*|[^\W\d_]+", re.UNICODE)
CJK = re.compile(r"[㐀-鿿]")
FENCE = re.compile(r"^`{3}(?:json)?|`{3}$", re.MULTILINE)


def load_prompt(role: str) -> tuple[str, str]:
    """返回 (system_prompt, version)。生成物首行的 GENERATED 注释不发给模型。"""
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

def _neighbour_content(context: dict, message: str, image_b64=None):
    fields = {
        "species_selected": context["species_selected"],
        "storyboard_visible_to_this_user": str(context["storyboard_visible_to_this_user"]).lower(),
    }
    own = context.get("own_entries") or []
    if own:
        # Tier 1 承诺助手看得到用户自己的 entry，但 §2.2 的模板里没有这个槽位，
        # 文档要补一行，见阶段 3 报告。
        fields["own_entries"] = "".join(
            "\n- " + " | ".join(f"{k}: {e[k]}" for k in ("species", "fun_fact", "story") if e.get(k))
            for e in own
        )
    text = _wrap(fields, message)
    if not image_b64:
        return text
    return [
        {"type": "text", "text": text},
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
    ]


def neighbour(client, context: dict, history, message: str, image_b64=None) -> dict:
    system, version = load_prompt("neighbour")
    content = _neighbour_content(context, message, image_b64)
    return {"reply": client.call("neighbour", system, content, history=history),
            "prompt_version": version}


class Stream:
    """把增量转发出去，同时把完整文本攒在 text 里，跑完才好落库。"""

    def __init__(self, prompt_version: str, chunks):
        self.prompt_version = prompt_version
        self.text = ""
        self._chunks = chunks

    def __iter__(self):
        for piece in self._chunks:
            self.text += piece
            yield piece


def neighbour_stream(client, context: dict, history, message: str, image_b64=None) -> Stream:
    system, version = load_prompt("neighbour")
    content = _neighbour_content(context, message, image_b64)
    return Stream(version, client.stream("neighbour", system, content, history=history))


# ---------- Writer ----------

def writer(client, species_selected: str, story_draft: str) -> dict:
    system, version = load_prompt("writer")
    prompt = _wrap({"species_selected": species_selected}, f"story_draft: {story_draft}")
    for _ in range(2):                      # §3.4 第 5 条：坏输出重试一次
        try:
            raw = client.call("writer", system, prompt)
        except UpstreamError:
            continue
        checked = validate_writer(raw, story_draft)
        if checked is not None:
            return {**checked, "prompt_version": version}
    # 两次都不行就静默跳过。Writer 永远不是必经步骤。
    return {"fun_facts": [], "tidied_story": None, "question": None, "skipped": True,
            "prompt_version": version}


def validate_writer(raw: str, original: str):
    """按 prompts.md §3.4 校验。返回 None 表示这次输出不可用，要重试。"""
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
        tidied = None                       # 丢掉润色，fun_facts 照留
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
    for _ in range(2):                      # 非法 JSON 重试一次，再失败按超时处理
        try:
            raw = client.call("screener", system, prompt)
        except UpstreamError:
            continue
        parsed = parse_verdict(raw)
        if parsed is not None:
            return _language_floor(parsed, submission, version)
    # fail-open：模型挂了不该让用户发不出内容（prompts.md §5）
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
    """operations.md §4.3：非英语提交最高只到 review，不得 reject。"""
    downgraded = result["verdict"] == "reject" and looks_non_english(submission)
    if downgraded:
        result["verdict"] = "review"
    return {**result, "fail_open": False, "downgraded_non_english": downgraded,
            "prompt_version": version}


def looks_non_english(text: str) -> bool:
    """只用来把 reject 降成 review，所以判错的方向永远是宽松那边。"""
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return False
    return sum(1 for c in letters if ord(c) > 127) / len(letters) > 0.1
