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

// 带上扩展名：Next 两种写法都认，而 `node --test` 只认带扩展名的那种。
// lib/api.test.mjs 要能直接 import 这个文件。
import * as fixtures from "./fixtures.js";

export const BASE = process.env.NEXT_PUBLIC_FENCEPOST_API || "http://127.0.0.1:8787";
export const MODE = process.env.NEXT_PUBLIC_FENCEPOST_MODE || "hybrid";
// 固定 handle。**设了就用它，没设就一人一个**——见下面的 visitorHandle。
//
// 这里原先的默认值是 "mel_k"，而 mel_k 是 demo 故事版的 owner：谁忘了配这个变量，
// 每一位访客就都成了 owner，归档、撤权限、删别人的条目全都拿得到。默认值现在是空的，
// 宁可退回「一人一个陌生身分」，也不要退回「所有人都是 owner」。
export const HANDLE = process.env.NEXT_PUBLIC_FENCEPOST_HANDLE || "";

// 每位访客自己的 handle 存在这里；兑换过入场码也记一笔，免得每次开页都兑一次。
const HANDLE_KEY = "fencepost.handle";
const JOINED_KEY = "fencepost.joined";

// 入场码：一张 contribute 档的分享链接，明文放在前端。
// 这不新增任何暴露——开放注册本来就让任何人拿任意 handle 换令牌，而这张码只给
// demo 故事版的 contribute。它换来的是**每位访客有自己的身分**，而不是所有人共用一个。
const JOIN_TOKEN = process.env.NEXT_PUBLIC_FENCEPOST_JOIN_TOKEN || "";

const FIXTURES_HANDLE = "mel_k";     // 离线演示里「我」是谁，和 fixtures 的 owner 对上

let ephemeralHandle = null;          // localStorage 用不了时的退路，只活在这一次会话

function readStore(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function writeStore(key, value) {
  try { window.localStorage.setItem(key, value); } catch { /* 无痕模式等，忽略 */ }
}

// 八个字节的密码学随机数，取十六进制。不用 Math.random：V8 的实现是 xorshift128+，
// 看过几个输出就能反推状态、预测后面的，而在开放注册下「知道一个 handle」等于
// 「能以那个人的身分登录」。拿可预测的数去生成一个能换到令牌的名字，是不对的。
//
// **但把话说全：这没有把洞补上。** handle 印在每一条 entry 上（`@{e.handle}`），
// 时间线也照回不误——它是公开的。谁在屏幕上读到 `@guest_…`，就能拿它去
// `/api/session` 换一张令牌，然后以那个人的身分改、删。熵防不住这一条，
// 因为这个值本来就是给人看的。
//
// 所以一人一个身分解决的是**误伤**：访客 A 不会再顺手改到访客 B 的东西，
// 因为他们不再是同一个用户。它不是一道安全边界——真正的边界是开放注册那个决定
// （CLAUDE.md 决策表），而那是明知代价留下的。见 operations.md §1.1。
function randomSuffix() {
  const bytes = new Uint8Array(8);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // 拿不到 CSPRNG 的环境早就不存在了（IE11 起就有）。真落到这里也不能让站崩，
  // 而且如上所述，这个值公开可见，本来就不是靠猜不到来保护的。
  return Array.from({ length: 8 },
    () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0")).join("");
}

// 一人一个 handle，存在浏览器里，所以回访的人还是自己，自己写的条目也还归自己。
//
// 为什么要这样：所有访客共用一个 handle 的时候，`author_id` 在他们之间是相等的，
// 于是访客 A 能改能删访客 B 写的东西——owner 那一层挡住了，访客彼此之间没有。
export function visitorHandle() {
  if (HANDLE) return HANDLE;                     // 显式配了就听它的（本机开发、测试）
  if (ephemeralHandle) return ephemeralHandle;
  const saved = readStore(HANDLE_KEY);
  if (saved) return saved;
  // 服务端校验 handle 长度 1..40，这里是 22。
  const made = "guest_" + randomSuffix();
  writeStore(HANDLE_KEY, made);
  // 存不进去（无痕模式）就退回会话内的临时身分：这一次浏览里至少还是同一个人，
  // 刷新之后换人——比每个请求换一次好。
  ephemeralHandle = made;
  return made;
}

export const usesNetwork = MODE !== "fixtures";
export const assistantIsLive = MODE === "live";

// 令牌只放内存。刷新就重新换一个——开放注册的前提下这没有代价，
// 而把 bearer token 塞进 localStorage 是给自己找麻烦。
let session = null;
let pending = null;

// 整个 session 都留着，不只是令牌：界面要用 user_id 判断「这条是不是我写的」
// （自己的 entry 不该出现投票按钮，服务端对作者投票回 403 not_your_call）
// 和「我是不是 owner」（撤销权限只有 owner 能做）。
async function ensureSession() {
  if (session) return session;
  if (!pending) {
    pending = request("/api/session", { body: { handle: visitorHandle() } })
      .then(async (got) => {
        session = got;
        await joinDemo(got.token);
        return got;
      })
      .finally(() => (pending = null));
  }
  return pending;
}

// 新访客换到令牌之后，拿入场码兑一张 contribute 的 grant，否则他打开就是空 dashboard：
// 一人一个身分的代价就是这个——新身分在任何故事版上都没有权限。
//
// 兑换不成不拦人。码可能过期了或被关掉了，那时候界面照常，只是看不到 demo 故事版——
// 比整个站崩掉好。链接有效期上限是 90 天（服务端强制 1..90），所以这不是「永远有效」，
// 到期要重签一张并更新 NEXT_PUBLIC_FENCEPOST_JOIN_TOKEN。
async function joinDemo(token) {
  if (!JOIN_TOKEN || readStore(JOINED_KEY)) return;
  try {
    await request("/api/share-links/redeem", { body: { token: JOIN_TOKEN }, auth: token });
    writeStore(JOINED_KEY, "1");
  } catch {
    /* 没兑上就算了，下次开页再试 */
  }
}

export async function me() {
  // 和 fixtures 里 GRANTS 的 owner_id 对上，否则分享页永远判不出「我是 owner」，
  // 撤销按钮一次都不会出现。
  if (!usesNetwork) return { user_id: "u_mel", handle: FIXTURES_HANDLE };
  const { user_id, handle } = await ensureSession();
  return { user_id, handle };
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
  return request(path, { ...options, auth: (await ensureSession()).token });
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

// 「我在这个故事版上能做什么」——档位和状态，不取时间线。
//
// 论坛那两屏要它。那边原先把「发主题」和回复框无条件画出来，而服务端对 view 档回
// read_only_access、对归档的回 storyboard_closed：一个按下去必然被拒的按钮，
// 正是 web/README.md 那条规矩说不要的东西。
//
// 取不到就回空档位，界面按「不能写」处理。宁可少给一个按钮，也不要给一个假的。
export async function boardAccess(id) {
  if (!usesNetwork) return fixtures.boardAccess(id);
  try {
    const boards = await dashboard();
    const board = [...boards.active, ...boards.past].find((b) => b.id === id);
    return { level: board?.level || null, status: board?.status || null };
  } catch {
    return { level: null, status: null };
  }
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

// 改自己的 entry。改动的字段会重新过一遍 Screener，被拒时**原文原封不动留在库里**，
// 服务端回的是 200 带 published:false —— 不是错误，所以别指望 catch 接得到。
// 字段缺省等于「不改这一项」：只传要改的那个。
export async function editEntry({ entryId, funFact, story }) {
  const body = { entry_id: entryId };
  if (funFact !== undefined) body.fun_fact = funFact;
  if (story !== undefined) body.story = story;
  if (!usesNetwork) return fixtures.editEntry(body);
  return call("/api/entries/edit", { body });
}

// 软删，立即生效：下一次取时间线就没有了，助手的上下文也同时看不到它
// （CLAUDE.md 安全底线：不吃缓存、不等 TTL）。
export async function deleteEntry(entryId) {
  if (!usesNetwork) return fixtures.deleteEntry(entryId);
  return call("/api/entries/delete", { body: { entry_id: entryId } });
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

// ── 复核（公开的社区投票，不是系统判定） ──────────────────
export async function castVote(entryId, vote) {
  // vote 是 looks_right 或 worth_checking。作者对自己的 entry 投票会被服务端挡回来，
  // 所以界面在自己的 entry 上根本不显示这两个按钮。
  if (!usesNetwork) return fixtures.castVote(entryId, vote);
  return call("/api/review/vote", { body: { entry_id: entryId, vote } });
}

// 待核实队列。**看不到自己的条目**，也拿不到任何作者身分——服务端的 SQL 里
// 既 `author_id != viewer`，返回的字段里也根本没有 handle 或 author_id。
// 作者对自己被标记这件事无感（operations §2.3）不是靠界面藏，是查询里就没有。
export async function reviewQueue(storyboardId) {
  if (!usesNetwork) return fixtures.reviewQueue(storyboardId);
  return call("/api/review?storyboard_id=" + encodeURIComponent(storyboardId));
}

// owner 的最终处置：kept | labelled | removed。removed 是软删，不是抹掉。
export async function disposeEntry(entryId, action) {
  if (!usesNetwork) return fixtures.disposeEntry(entryId, action);
  return call("/api/review/dispose", { body: { entry_id: entryId, action } });
}

// ── 讨论区 ────────────────────────────────────────────────
// 单独的表、单独的端点。助手的上下文物理上够不到这里，这是故意的。
export async function forumThreads(storyboardId) {
  if (!usesNetwork) return fixtures.forumThreads(storyboardId);
  return call("/api/forum?storyboard_id=" + encodeURIComponent(storyboardId));
}

export async function readThread(threadId) {
  if (!usesNetwork) return fixtures.readThread(threadId);
  return call("/api/forum/thread?thread_id=" + encodeURIComponent(threadId));
}

export async function createThread({ storyboardId, title, body }) {
  if (!usesNetwork) return fixtures.createThread({ storyboardId, title, body });
  return call("/api/forum/threads", { body: { storyboard_id: storyboardId, title, body } });
}

export async function createPost({ threadId, body }) {
  if (!usesNetwork) return fixtures.createPost({ threadId, body });
  return call("/api/forum/posts", { body: { thread_id: threadId, body } });
}

// ── 分享与权限 ────────────────────────────────────────────
export async function issueShareLink({ storyboardId, level, expiresInDays }) {
  if (!usesNetwork) return fixtures.issueShareLink({ storyboardId, level, expiresInDays });
  return call("/api/share-links", {
    body: { storyboard_id: storyboardId, level, expires_in_days: expiresInDays },
  });
}

export async function redeemShareLink(token) {
  if (!usesNetwork) return fixtures.redeemShareLink(token);
  return call("/api/share-links/redeem", { body: { token } });
}

export async function grants(storyboardId) {
  if (!usesNetwork) return fixtures.grants(storyboardId);
  return call("/api/grants?storyboard_id=" + encodeURIComponent(storyboardId));
}

// 我是不是这个故事版的 owner。
//
// 只有 owner 能完结（服务端 close_storyboard 回 not_the_owner），而 owner 一定是
// reshare 档——所以非 reshare 直接回 false，连问都不用问。这样也顺带绕开了
// /api/grants 的门：那个端点本来就要 reshare 才读得到，owner_id 是刻意只给他们的。
//
// 没有把 owner_id 加进 /api/dashboard，是为了不把这个字段放宽给 view 档的人。
export async function isOwner(storyboardId, level) {
  if (level !== "reshare") return false;
  try {
    const [access, who] = await Promise.all([grants(storyboardId), me()]);
    return !!who && who.user_id === access.owner_id;
  } catch {
    return false;
  }
}

// owner 主动完结，可以附一句结语。**不可逆**——没有任何端点能把它开回来，
// 而且它会把这个故事版上的助手对话一并删掉（db.close_storyboard 里那条 DELETE）。
// 界面上这两件事都得说出来。
export async function closeStoryboard({ storyboardId, closedNote }) {
  const body = { storyboard_id: storyboardId };
  if (closedNote) body.closed_note = closedNote;
  if (!usesNetwork) return fixtures.closeStoryboard(body);
  return call("/api/storyboards/close", { body });
}

// 这个故事版发出去过的码。**永远不含 token**——库里只有 SHA-256，明文在签发那一刻
// 出现过一次就没了。所以列表认的是「哪一档、谁发的、什么时候过期、还灵不灵」，
// 不是「那张码是什么」。撤销过的也在列表里：关掉之后得看得出关成了。
export async function shareLinks(storyboardId) {
  if (!usesNetwork) return fixtures.shareLinks(storyboardId);
  return call("/api/share-links?storyboard_id=" + encodeURIComponent(storyboardId));
}

// 关掉一张码。**它不撤销已经用这张码换到的权限**——那是另一件事，走 revokeGrant。
// 服务端的门是「你发的，或者你是 owner」，不是 reshare：
// 一个 reshare 档的人关不掉别人发的码。
export async function revokeShareLink(shareLinkId) {
  if (!usesNetwork) return fixtures.revokeShareLink(shareLinkId);
  return call("/api/share-links/revoke", { body: { share_link_id: shareLinkId } });
}

export async function revokeGrant({ storyboardId, userId }) {
  if (!usesNetwork) return fixtures.revokeGrant({ storyboardId, userId });
  return call("/api/grants/revoke", { body: { storyboard_id: storyboardId, user_id: userId } });
}

// 演示用的离线降级。设成 offline 就让助手区显示降级文案，输入框照常可用——
// 这是 prototype-user-flow 要的那个状态，不是错误处理。
export const assistantOffline = process.env.NEXT_PUBLIC_FENCEPOST_ASSISTANT === "offline";
