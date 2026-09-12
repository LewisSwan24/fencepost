// Fencepost API 客户端。两个 Vercel 专案，所以这里是跨域调用。
//
// fixtures 模式下一个请求都不发：答辩现场走固定回应，理由见 CLAUDE.md —— 真模型有概率
// 说出违反红线的话，现场没有第二次机会。回应形状与 qwen-integration.md §6 的契约一致，
// 尤其是 Screener 只回 published 和 reason_codes，永远不回 verdict 或 note。

export const BASE =
  process.env.NEXT_PUBLIC_FENCEPOST_API || "http://127.0.0.1:8787";
export const MODE = process.env.NEXT_PUBLIC_FENCEPOST_MODE || "live";

const VERSION = "v0.11";

// 演示用的固定回应。键是路径，值是函数，拿到请求体好回得像样一点。
const FIXTURES = {
  "/api/session": (body) => ({
    user_id: "fixture-user",
    handle: body.handle || "neighbour",
    token: "fixture-token",
  }),
  "/api/storyboards": () => ({
    storyboard_id: "fixture-storyboard",
    title: "Fence at number 12",
  }),
  // 提交被拒的样子也要能演示。触发条件是确定的：正文里带这个假地址就走拒绝分支。
  // 注意回的是 reason_codes，没有 verdict 也没有 note——作者永远看不到内部判定。
  "/api/entries": (body) =>
    String(body.story || "").includes("42 Example St")
      ? { published: false, reason_codes: ["pii"], prompt_version: VERSION }
      : { entry_id: "fixture-entry", published: true, prompt_version: VERSION },
  "/api/assistant": (body) =>
    body.role === "writer"
      ? {
          role: "writer",
          fun_facts: [
            {
              text: "Ringtails build nests called dreys and carry the material with their tail.",
              confidence: "established",
            },
            {
              text: "People often say they only eat leaves, though they take fruit and flowers too.",
              confidence: "unverified",
            },
          ],
          tidied_story: "One on the fence at eleven, staring at me for a while.",
          question: null,
          skipped: false,
          prompt_version: VERSION,
        }
      : {
          role: "neighbour",
          reply:
            "That sounds like a ringtail. The curled tail is the giveaway, since brushtails have bushy ones. Check the tip next time to be sure.",
          prompt_version: VERSION,
        },
  "/api/forum/threads": () => ({
    thread_id: "fixture-thread",
    post_id: "fixture-post",
    published: true,
    prompt_version: VERSION,
  }),
  "/api/timeline": () => ({
    storyboard_id: "fixture-storyboard",
    entries: [
      {
        id: "fixture-entry",
        handle: "neighbour",
        species: "ringtail",
        fun_fact: "Ringtails carry nesting material with their tail.",
        story: "One on the fence at eleven, stared at me for a while.",
        being_checked: 0,
        created_at: "2026-09-13T11:00:00+00:00",
      },
    ],
  }),
  "/api/dashboard": () => ({
    active: [
      {
        id: "fixture-storyboard",
        title: "Fence at number 12",
        status: "active",
        level: "reshare",
        entry_count: 1,
        last_entry_at: "2026-09-13T11:00:00+00:00",
      },
    ],
    past: [],
  }),
  "/api/forum": () => ({
    storyboard_id: "fixture-storyboard",
    threads: [
      {
        id: "fixture-thread",
        title: "Who else hears it at 2am",
        handle: "neighbour",
        post_count: 2,
        created_at: "2026-09-13T11:05:00+00:00",
      },
    ],
  }),
  "/api/review": () => ({ storyboard_id: "fixture-storyboard", items: [] }),
};

function fixtureFor(path, body) {
  const key = path.split("?")[0];
  const make = FIXTURES[key];
  if (!make) throw new Error("no fixture for " + key);
  return make(body || {});
}

export async function call(path, { method = "POST", body, token } = {}) {
  if (MODE === "fixtures") {
    await new Promise((done) => setTimeout(done, 150)); // 假装网络存在
    return fixtureFor(path, body);
  }
  const headers = {};
  if (body) headers["content-type"] = "application/json";
  if (token) headers["authorization"] = "Bearer " + token;
  const response = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) {
    // 代理回的永远是固定文案，直接给用户看是安全的
    const message = payload?.error?.message || "Something went wrong.";
    throw new Error(message);
  }
  return payload;
}

export function get(path, token) {
  return call(path, { method: "GET", token });
}

// 流式：一行一个 data:，第一帧是版本号，中间是 delta，最后是 done 或 error。
export async function streamAssistant({ token, storyboardId, message, onDelta }) {
  if (MODE === "fixtures") {
    const words = fixtureFor("/api/assistant").reply.split(" ");
    for (const word of words) {
      await new Promise((done) => setTimeout(done, 40));
      onDelta(word + " ");
    }
    return VERSION;
  }
  const response = await fetch(BASE + "/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + token },
    body: JSON.stringify({
      role: "neighbour",
      storyboard_id: storyboardId,
      message,
      stream: true,
    }),
  });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message || "The assistant is not answering.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let version = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const frame = JSON.parse(line.slice(6));
      if (frame.prompt_version) version = frame.prompt_version;
      if (frame.delta) onDelta(frame.delta);
      if (frame.error) throw new Error(frame.error.message);
    }
  }
  return version;
}
