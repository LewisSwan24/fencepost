// Fencepost 的 API 客户端。两个 Vercel 专案，所以这里是跨域调用。
//
// 三种模式，用 NEXT_PUBLIC_FENCEPOST_MODE 选：
//
//   hybrid   （默认）CRUD 打真后端，助手走 fixture。答辩用这个。
//   fixtures 一个请求都不发。断网也能演，但演不出后端。
//   live     全部走真后端，助手也是。开发时用。
//
// 为什么助手单独拎出来：真模型有概率说出一句违反红线的话，现场没有第二次机会
// （CLAUDE.md）。CRUD 那半边没有这个风险，而且那条链路 2026-09-13 刚对着真部署
// 验到 12/12，藏起来不演可惜。
//
// hybrid 和 live 都需要一个令牌，而令牌只能从 /api/session 换，那个端点默认关着，
// 要部署上有 FENCEPOST_OPEN_SIGNUP 才开。这是这两种模式的前提，不是可选项。

import * as fixtures from "./fixtures";

export const BASE = process.env.NEXT_PUBLIC_FENCEPOST_API || "http://127.0.0.1:8787";
export const MODE = process.env.NEXT_PUBLIC_FENCEPOST_MODE || "hybrid";
export const HANDLE = process.env.NEXT_PUBLIC_FENCEPOST_HANDLE || "mel_k";

export const usesNetwork = MODE !== "fixtures";
export const assistantIsLive = MODE === "live";

// 令牌只放内存。刷新就重新换一个——开放注册的前提下这没有代价，
// 而把 bearer token 塞进 localStorage 是给自己找麻烦。
let token = null;
let pending = null;

async function ensureToken() {
  if (token) return token;
  if (!pending) {
    pending = request("/api/session", { body: { handle: HANDLE } })
      .then((session) => {
        token = session.token;
        return token;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

async function request(path, { method, body, auth } = {}) {
  const headers = {};
  if (body) headers["content-type"] = "application/json";
  if (auth) headers.authorization = "Bearer " + auth;
  const response = await fetch(BASE + path, {
    method: method || (body ? "POST" : "GET"),
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    // 代理回的永远是固定文案，直接给用户看是安全的。
    throw new ApiError(payload?.error?.message || "Something went wrong.", response.status,
                       payload?.error?.code);
  }
  return payload;
}

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function call(path, options = {}) {
  return request(path, { ...options, auth: await ensureToken() });
}

// ── 故事版 ────────────────────────────────────────────────
export async function dashboard() {
  if (!usesNetwork) return fixtures.dashboard();
  return call("/api/dashboard");
}

export async function createStoryboard(title) {
  if (!usesNetwork) return fixtures.createStoryboard(title);
  return call("/api/storyboards", { body: { title } });
}

export async function timeline(storyboardId) {
  if (!usesNetwork) return fixtures.timeline(storyboardId);
  return call("/api/timeline?storyboard_id=" + encodeURIComponent(storyboardId));
}

// 状态是 active | readonly | archived —— 没有 past 这个值。原型里写的是 past，
// 照搬过来的话归档态永远不会触发（issue #22 findings 3）。
//
// 写成白名单而不是 status !== "active"：/api/timeline 不回 status，取反的写法会把
// undefined 判成已归档，于是刚建出来的故事版顶着一条「这个已经安静下来了」的横幅。
// 拦不拦是服务端的事（storyboard_closed），客户端只负责显示，显示错了就是撒谎。
export function isArchived(status) {
  return status === "readonly" || status === "archived";
}

// 时间线不带故事版本身的信息，dashboard 才有。两个一起取。
export async function storyboard(id) {
  if (!usesNetwork) return fixtures.timeline(id);
  const [boards, feed] = await Promise.all([dashboard(), timeline(id)]);
  const board = [...boards.active, ...boards.past].find((b) => b.id === id);
  return { ...(board || {}), ...feed };
}

// ── 投稿 ──────────────────────────────────────────────────
export async function submitEntry({ storyboardId, species, funFact, story }) {
  const body = {
    storyboard_id: storyboardId,
    species,                        // brushtail | ringtail | other | unknown
    fun_fact: funFact || undefined,
    story,
  };
  if (!usesNetwork) return fixtures.submitEntry(body);
  return call("/api/entries", { body });
}

// ── 助手 ──────────────────────────────────────────────────
export async function askAssistant(message, storyboardId) {
  if (!assistantIsLive) return delayed(fixtures.assistantReply(message));
  return call("/api/assistant", {
    body: { role: "neighbour", storyboard_id: storyboardId, message },
  });
}

export async function writerHelp(species, story) {
  if (!assistantIsLive) return delayed(fixtures.writer(species, story));
  return call("/api/assistant", {
    body: { role: "writer", species_selected: species, story_draft: story },
  });
}

// 认帧。真接口没有 role:"vision" 这回事——它就是一次 neighbour 调用，带上帧和用户
// 那一下确认。少了 frame_consent，_admit 会回 frame_consent_missing（issue #22 findings 4）。
export async function identifyFrame({ storyboardId, imageBase64 }) {
  if (!assistantIsLive) {
    return delayed({ role: "neighbour", reply: fixtures.VISION_REPLY,
                     prompt_version: fixtures.PROMPT_VERSION });
  }
  return call("/api/assistant", {
    body: {
      role: "neighbour",
      storyboard_id: storyboardId,
      message: "Which possum is this?",
      image_b64: imageBase64,
      frame_consent: true,
    },
  });
}

// fixture 是同步的，但界面得看得出「它在想」。给一点真实的等待。
function delayed(value, ms = 650) {
  return new Promise((done) => setTimeout(() => done(value), ms));
}
