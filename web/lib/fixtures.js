// 原型里的固定应答，搬过来的时候修了三处契约不符（见 issue #22 的核验报告）：
//   species 的第四档是 unknown 不是 unsure —— 真 API 的集合是
//     {brushtail, ringtail, other, unknown}，发 unsure 直接 400；
//   故事版状态是 active | readonly | archived，没有 past；
//   没有 role:"vision" 这个东西 —— 认帧是一次 neighbour 调用，带 image_b64
//     和 frame_consent，回的还是 {role, reply, prompt_version}。
//
// 为什么助手在答辩现场必须走这里：真模型有概率说出一句违反红线的话，现场没有第二次机会。
// 见 CLAUDE.md。CRUD 那半边走的是真后端。

export const PROMPT_VERSION = "v0.11";

export const SPECIES = [
  { id: "brushtail", label: "Brushtail", sub: "Common Brushtail Possum" },
  { id: "ringtail", label: "Ringtail", sub: "Common Ringtail Possum" },
  { id: "other", label: "Something else", sub: "Not a possum" },
  { id: "unknown", label: "Not sure", sub: "Leave it open" },
];

export const SPECIES_LABEL = Object.fromEntries(SPECIES.map((s) => [s.id, s.label]));

// 用户刚拍的那段。服务端只会有一个 storage_key —— EXIF 没有字段可以落地。
export const CLIP = {
  default_index: 3,
  frames: [
    { t: 0, label: "0:00", tone: 0 },
    { t: 2, label: "0:02", tone: 1 },
    { t: 4, label: "0:04", tone: 2 },
    { t: 6, label: "0:06", tone: 3 },
    { t: 8, label: "0:08", tone: 2 },
    { t: 10, label: "0:10", tone: 1 },
    { t: 12, label: "0:12", tone: 0 },
    { t: 14, label: "0:14", tone: 1 },
  ],
  // 画面里能认出人或房子的东西，按画面百分比。
  mask_targets: [
    { id: "face", label: "Face", x: 13, y: 30, w: 17, h: 23 },
    { id: "plate", label: "Number plate", x: 55, y: 64, w: 28, h: 14 },
  ],
};

// 认帧的回应。真接口回的是散文，不是结构化的物种字段，所以这里也回散文——
// 界面自己从句子里认出物种（见 suggestedSpecies），认不出就只显示句子，不给「Use this」。
// 这样对着真 API 也是同一套逻辑，而且天然满足「建议永不自动选中」。
export const VISION_REPLY =
  "Looks most like a Brushtail — going by the bushy tail. Check the ears to be sure.";

export function suggestedSpecies(reply) {
  const text = String(reply || "").toLowerCase();
  const hits = ["brushtail", "ringtail"].filter((name) => text.includes(name));
  return hits.length === 1 ? hits[0] : null;
}

// Writer。只给候选，永远不替用户填。confidence 只有 established 和 unverified。
const FUN_FACTS = {
  brushtail: [
    {
      text: "Brushtails are the possum most likely to end up in a Brisbane roof. They den in tree hollows when they can get one, and a roof cavity is the next best thing.",
      confidence: "established",
    },
    {
      text: "People often say the same brushtail comes back to a roof year after year, though that is more neighbourhood lore than anything settled.",
      confidence: "unverified",
    },
  ],
  ringtail: [
    {
      text: "Ringtails build nests called dreys and carry the material with their tail.",
      confidence: "established",
    },
    {
      text: "People often say they only eat leaves, though they take fruit and flowers too.",
      confidence: "unverified",
    },
  ],
  other: [],
  unknown: [],
};

// 润色只动空格、大小写和句号，不增删任何具体细节。真 Writer 用模型做同一件事。
function tidy(story) {
  let t = String(story || "").trim().replace(/\s+/g, " ");
  if (!t) return null;
  t = t.replace(/\bi\b/g, "I").replace(/\s+([,.!?])/g, "$1");
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.!?]$/.test(t)) t += ".";
  return t;
}

export function writer(species, story) {
  const facts = FUN_FACTS[species] || [];
  const tidied = tidy(story);
  return {
    role: "writer",
    fun_facts: facts,
    tidied_story: tidied,
    question: tidied ? null : "What was it doing when you started filming?",
    skipped: facts.length === 0,
    prompt_version: PROMPT_VERSION,
  };
}

// ── 助手对话 ──────────────────────────────────────────────
// 四条演示脚本，逐字照 docs/prompts.md 的 §固定应答 实现，不改写不加句子。
export const ASSISTANT_SCRIPT = [
  {
    key: "roof",
    question: "How do I catch the possum in my roof?",
    reply:
      "Possums are protected here, so trapping one needs a licensed operator — it's not a DIY job. The part that actually solves it is sealing the entry points, otherwise the next one moves in. The Queensland environment department can point you to licensed controllers.",
  },
  {
    key: "bandicoot",
    question: "I filmed a bandicoot digging up the lawn, what is it doing?",
    reply:
      "Possums are all I know about, sorry. Post it anyway though — plenty of people here will recognise it.",
  },
  {
    key: "snake",
    question: "There's a brown snake on my patio, what do I do?",
    reply:
      "That's outside what I can help with, and I won't guess at a snake either way. Keep people and pets well back, watch it from a distance, and call a licensed snake catcher for your suburb. If anyone's been bitten, call 000 now.",
  },
  {
    key: "others",
    question: "What did the other people write in this storyboard?",
    reply:
      "I can't see anyone else's entries — only what you've written. Scroll the timeline and you'll see them all.",
  },
];

export const ASSISTANT_DISCLOSURE = {
  lead: "Possum Help",
  rest: " — I'm an AI assistant, not a person. I know about brushtail and ringtail possums around Brisbane. Ask me anything about the one you filmed.",
};

export const ASSISTANT_OFFLINE =
  "The assistant is offline right now. Writing and posting work as normal.";

// 另一种动物，而且那个动物得是句子的主语。「Will it hurt my cat?」问的是宠物，
// 不是在报告一只猫，该走 injured。排在 injured 和 welfare 后面也是这个道理。
// 用正则字面量拿 .source 拼，不在字符串里写双反斜杠——那种写法少转义一层就成了
// 退格符而不是词边界，一声不吭地永远不匹配。这一条本来就是这样坏掉的。
const ANIMAL = /bandicoot|koala|wallaby|kangaroo|rats?|mice|mouse|birds?|magpie|curlew|turkey|cockatoo|lorikeet|kookaburra|cats?|dogs?|fox|goanna|lizard|skink|frog|spider|opossum|raccoon/;
const SAW = /filmed|film|saw|see|caught|got|have|found|watched/;
const DID = /is|was|are|were|has|have|had|keeps?|kept|came|comes?|went|goes|dug|digs?|digging|eating|ate|sitting|sat|running|ran|doing|does|did|got|gets/;

const OTHER_ANIMAL_SUBJECT = new RegExp(
  [
    String.raw`\bi (?:${SAW.source})\s+(?:a|an|the|some|two|my|this)?\s*(?:${ANIMAL.source})\b`,
    String.raw`\b(?:${ANIMAL.source})\s+(?:${DID.source})\b`,
    String.raw`^(?:a|an|the|my|this|that|some|there'?s?(?:\s+is)?\s+(?:a|an|the)?)\s*(?:${ANIMAL.source})\b`,
  ].join("|"),
  "i"
);

// 按主题排，不按碰巧出现的词排：安全在最前，然后是 neighbour.txt 和 shared.txt
// 真正规定了的分支，最后才是范围外。每条回复要么是上面四条脚本之一，要么直接出自那两个文件。
const ROUTES = [
  {
    // shared.txt SAFETY FALLBACK —— 蝙蝠不给范围那句，不评论安不安全，
    // 且只有接种过的人能碰。
    key: "bat",
    match: /\bbats?\b|flying.?fox/i,
    reply:
      "Bats are outside what I cover, and I won't say anything about whether one is safe to be near. Keep people and pets back, and don't pick it up — not even if it looks hurt or stuck. Only vaccinated handlers should touch a bat. The RSPCA hotline on 1300 ANIMAL (1300 264 625) handles them, and a bite or scratch means 000 and medical help straight away.",
  },
  { key: "snake", match: /\bsnakes?\b|\bpython\b|\bviper\b|\badder\b/i, script: "snake" },
  {
    // neighbour.txt CONTEXT BOUNDARY —— 别人的 entry。
    key: "others",
    match: /other (people|entries|contributors|storyboard)|anyone else|everyone else|what did .*(write|post|say)|who (posts|posted|writes)|most (posts|entries)/i,
    script: "others",
  },
  {
    // CONTEXT BOUNDARY —— 不能分享、邀请、给权限；指一下控件就停。
    key: "access",
    match: /invite|share|\bqr\b|revoke|give .* access|post (this|it) for me|on my behalf/i,
    reply:
      "I can't share a storyboard or invite anyone — that part is yours. The Share button on the storyboard is where the QR code and the access settings live.",
  },
  {
    // neighbour.txt INJURED, SICK OR ORPHANED —— 不做判断，先打 RSPCA。
    key: "injured",
    match: /injur|\bhurt\b|sick|bleeding|\bdead\b|dying|orphan|\bbaby\b|\bjoey\b|stuck|caught in/i,
    reply:
      "I can't tell how badly hurt it is, so don't touch it yet. Call the RSPCA on 1300 ANIMAL (1300 264 625) and they'll tell you whether handling it is the right move — they're on 7am to 7pm every day, and their site has the after-hours list. Keep your distance and keep pets away until then.",
  },
  {
    // shared.txt ANIMAL WELFARE HARD RULE —— 匹配投喂或上手的意图，
    // 不匹配食物这个名词。「Do they eat fruit?」问的是食性。
    key: "welfare",
    match: /\bfeed(s|ing)?\b|hand.?feed|give (it|them|him|her)\b|leave (out|some|food|fruit)|put out (food|fruit|bread)|\bbait\b|\blure\b|\btouch\b|hold (it|them)|\bpat\b|pick (it|him|her|them) up|\bwake\b/i,
    reply:
      "Best not to — feeding them or handling them does harm, even when it's meant kindly. Watch from a distance and let it get on with what it's doing.",
  },
  { key: "other_animal", match: OTHER_ANIMAL_SUBJECT, script: "bandicoot" },
  {
    // neighbour.txt POSSUM IN A ROOF OR WALL.
    key: "roof",
    match: /in (my|the) (roof|ceiling|wall)|roof (cavity|space)|\btrap|relocat|seal|entry point|get (it|them) out|living in/i,
    script: "roof",
  },
  {
    // neighbour.txt DIET —— 食性是范围内的问题，答它，不要变成一句别喂。
    key: "diet",
    match: /\beat\b|\beats\b|\bdiet\b|what do they (eat|live on)|feed on/i,
    reply:
      "Both of them are mostly leaf eaters, and they take fruit, flowers and buds when those are around — which is why a mango tree or a jacaranda in flower gets so much traffic. Ringtails lean harder on leaves than brushtails do.",
  },
  {
    // neighbour.txt SPECIES ID —— 永不下定论；说清楚该看哪个特征，
    // 顺带提一句可以送帧去认，但不推。
    key: "species",
    match: /(brushtail|ringtail)[^?.!]{0,12}or[^?.!]{0,12}(brushtail|ringtail)|which (one|species|kind)|what (kind|sort|species)|is (it|this)( one)? a (brushtail|ringtail)|identif|tell them apart/i,
    reply:
      "I won't call it either way from here. Have a look at the tail — bushy means brushtail, thin and curled at the tip means ringtail — and the ears will back that up. You can also send the frame for identification if you'd rather.",
  },
];

// 范围内但不在这几条里。shared.txt HONESTY：不知道就说不知道，
// 然后给出 neighbour.txt 规定的那个区分问题，而不是猜。
const FALLBACK =
  "I've only got a few answers loaded in this prototype, so I'd be guessing at that one. If it helps, tell me about the tail — bushy, or thin and curled at the tip — and I can say which of the two it looks like.";

export function assistantReply(text) {
  const route = ROUTES.find((r) => r.match.test(String(text || "")));
  const reply = !route
    ? FALLBACK
    : route.script
      ? ASSISTANT_SCRIPT.find((s) => s.key === route.script).reply
      : route.reply;
  return { role: "neighbour", reply, prompt_version: PROMPT_VERSION };
}

// 流式那条路的同一个回答，帧形状和真代理一致：首帧带版本号，中间是 delta，末帧 done。
export function assistantFrames(text) {
  const { reply } = assistantReply(text);
  return [
    { prompt_version: PROMPT_VERSION },
    ...(reply.match(/\S+\s*/g) || []).map((delta) => ({ delta })),
    { done: true },
  ];
}

// ── 离线数据集（只有 fixtures 模式用得上；hybrid 下这一段是死的） ──
// 状态用真的那三个值：active | readonly | archived。原型里写的 past 不是状态，
// 是 dashboard 分组的名字——两回事，混在一起归档态就永远不触发。
const STORYBOARDS = {
  sb_jacaranda: {
    id: "sb_jacaranda",
    title: "The one in the jacaranda",
    suburb: "Paddington",
    status: "active",
    level: "reshare",
    participants: ["mel_k", "dan_h", "aroha_t", "sione_f"],
    entry_count: 5,
    last_entry_at: "2026-09-12T21:47:00+10:00",
  },
  sb_roof: {
    id: "sb_roof",
    title: "Roof thumper",
    suburb: "Annerley",
    status: "archived",
    level: "view",
    participants: ["mel_k", "dan_h"],
    entry_count: 3,
    last_entry_at: "2026-08-02T23:12:00+10:00",
  },
};

const TIMELINES = {
  sb_jacaranda: [
    {
      id: "e5", handle: "mel_k", species: "ringtail",
      fun_fact: "Ringtails build nests called dreys and carry the material with their tail.",
      story: "Back again tonight. Went along the top of the fence, then sat in the jacaranda for ages pulling the flowers off the end of a branch.",
      being_checked: 0, created_at: "2026-09-12T21:47:00+10:00",
    },
    {
      id: "e4", handle: "sione_f", species: "brushtail", fun_fact: null,
      story: "2am, roof, again. Caught him coming down the drainpipe on the side of the house. Absolutely unbothered by me standing there in my dressing gown.",
      being_checked: 0, created_at: "2026-09-10T02:18:00+10:00",
    },
    {
      id: "e3", handle: "aroha_t", species: "ringtail",
      fun_fact: "People often say they only eat leaves, though they take fruit and flowers too.",
      story: "two of them this time. one stayed right up the top and kept making that clicking noise the whole time, couldn't get both of them in frame",
      being_checked: 1, created_at: "2026-09-08T20:05:00+10:00",
    },
    {
      id: "e2", handle: "dan_h", species: "brushtail", fun_fact: null,
      story: "Pretty sure this is a different one, much bigger. Came over the back fence and went straight up the trunk without stopping.",
      being_checked: 0, created_at: "2026-09-05T22:30:00+10:00",
    },
    {
      id: "e1", handle: "mel_k", species: "ringtail", fun_fact: null,
      story: "Heard the gutter go and there she was, just sitting in the jacaranda looking at me while I filmed. Didn't move the whole time.",
      being_checked: 0, created_at: "2026-09-02T21:14:00+10:00",
    },
  ],
  sb_roof: [
    {
      id: "r3", handle: "dan_h", species: "brushtail", fun_fact: null,
      story: "Last one from me. Roof's been quiet since the tree out the back got cut right down.",
      being_checked: 0, created_at: "2026-08-02T23:12:00+10:00",
    },
    {
      id: "r2", handle: "mel_k", species: "brushtail", fun_fact: null,
      story: "Thumping right over the bedroom again. Filmed the gutter for five minutes and got about two seconds of him.",
      being_checked: 0, created_at: "2026-07-28T01:40:00+10:00",
    },
    {
      id: "r1", handle: "mel_k", species: "brushtail",
      fun_fact: "Brushtails den in tree hollows when they can get one, which is why a roof cavity suits them.",
      story: "Started this one because of the noise. Not much to see yet, but here he is on the way up.",
      being_checked: 0, created_at: "2026-07-25T22:55:00+10:00",
    },
  ],
};

// 被拒的样子也要能演。触发条件是确定的：正文里带这个假地址。
// 回的只有 reason_codes——没有 verdict 也没有 note，作者永远看不到内部判定。
export const BLOCKED_TRIGGER = "42 Example St";

export const REASON_COPY = {
  pii: "This mentions someone's address or name. Take that part out and you're good to post.",
};

let entrySeq = 0;

export function dashboard() {
  const all = Object.values(STORYBOARDS).map((b) => ({ ...b }));
  return {
    active: all.filter((b) => b.status === "active"),
    past: all.filter((b) => b.status !== "active"),
  };
}

export function timeline(storyboardId) {
  return {
    storyboard_id: storyboardId,
    ...STORYBOARDS[storyboardId],
    entries: (TIMELINES[storyboardId] || []).map((e) => ({ ...e })),
  };
}

export function createStoryboard(title) {
  const id = "sb_" + Math.random().toString(36).slice(2, 8);
  STORYBOARDS[id] = {
    id, title, suburb: "Brisbane", status: "active", level: "reshare",
    participants: ["mel_k"], entry_count: 0, last_entry_at: new Date().toISOString(),
  };
  TIMELINES[id] = [];
  return { storyboard_id: id, title };
}

export function submitEntry(body) {
  if (String(body.story || "").includes(BLOCKED_TRIGGER)) {
    return { published: false, reason_codes: ["pii"], prompt_version: PROMPT_VERSION };
  }
  entrySeq += 1;
  const entry = {
    id: "e_new_" + entrySeq,
    handle: "mel_k",
    species: body.species,
    fun_fact: body.fun_fact || null,
    story: body.story,
    being_checked: 0,
    created_at: new Date().toISOString(),
  };
  const list = TIMELINES[body.storyboard_id] || (TIMELINES[body.storyboard_id] = []);
  list.unshift(entry);
  const board = STORYBOARDS[body.storyboard_id];
  if (board) {
    board.entry_count = list.length;
    board.last_entry_at = entry.created_at;
  }
  return { entry_id: entry.id, published: true, prompt_version: PROMPT_VERSION };
}

// ── 讨论区（离线数据集） ──
// 单独的表、单独的端点。助手够不到这里，是设计如此，不是碰巧。
const FORUM = {
  sb_jacaranda: [
    {
      id: "t1", handle: "dan_h", title: "Anyone else's mango tree getting stripped?",
      created_at: "2026-09-11T19:22:00+10:00", post_count: 4,
      posts: [
        { id: "t1p0", handle: "dan_h", created_at: "2026-09-11T19:22:00+10:00",
          body: "Half the fruit is gone and what's left has bites out of it. Assuming it's the same one that's been on the fence, but I've never actually seen it in the tree." },
        { id: "t1p1", handle: "aroha_t", created_at: "2026-09-11T20:04:00+10:00",
          body: "Same here with the lillypilly. They go for the soft stuff first and leave the rest on the ground." },
        { id: "t1p2", handle: "mel_k", created_at: "2026-09-11T21:40:00+10:00",
          body: "Mine only started once the fruit got ripe. Netting helped but you have to get the edges right or they just walk under it." },
        { id: "t1p3", handle: "sione_f", created_at: "2026-09-12T08:15:00+10:00",
          body: "Picked the last of ours early this year and it was fine on the windowsill. Beat them to it basically." },
      ],
    },
    {
      id: "t2", handle: "sione_f", title: "What actually keeps them out of the roof?",
      created_at: "2026-09-09T22:10:00+10:00", post_count: 3,
      posts: [
        { id: "t2p0", handle: "sione_f", created_at: "2026-09-09T22:10:00+10:00",
          body: "Had one going up the drainpipe every night for a fortnight. Before I spend money on it — what worked for people here?" },
        { id: "t2p1", handle: "dan_h", created_at: "2026-09-10T07:35:00+10:00",
          body: "Sealing the gaps once it's out, and doing it at night when you know it's not in there. Ours came back for a week and gave up." },
        { id: "t2p2", handle: "mel_k", created_at: "2026-09-10T19:02:00+10:00",
          body: "Ours was the gap where the gutter meets the eave. Took a torch and a lot of squinting to find it." },
      ],
    },
  ],
  sb_roof: [],
};

let forumSeq = 0;

export function forumThreads(storyboardId) {
  const threads = (FORUM[storyboardId] || []).map(({ posts, ...rest }) => rest);
  return { storyboard_id: storyboardId, threads };
}

export function readThread(threadId) {
  for (const list of Object.values(FORUM)) {
    const thread = list.find((t) => t.id === threadId);
    if (thread) return { thread_id: threadId, title: thread.title, posts: thread.posts.map((p) => ({ ...p })) };
  }
  return { thread_id: threadId, posts: [] };
}

export function createThread({ storyboardId, title, body }) {
  forumSeq += 1;
  const id = "t_new_" + forumSeq;
  const now = new Date().toISOString();
  const thread = {
    id, handle: "mel_k", title, created_at: now, post_count: 1,
    posts: [{ id: id + "p0", handle: "mel_k", body, created_at: now }],
  };
  (FORUM[storyboardId] || (FORUM[storyboardId] = [])).unshift(thread);
  return { thread_id: id, post_id: thread.posts[0].id, published: true, prompt_version: PROMPT_VERSION };
}

export function createPost({ threadId, body }) {
  for (const list of Object.values(FORUM)) {
    const thread = list.find((t) => t.id === threadId);
    if (!thread) continue;
    forumSeq += 1;
    const post = { id: "p_new_" + forumSeq, handle: "mel_k", body, created_at: new Date().toISOString() };
    thread.posts.push(post);
    thread.post_count = thread.posts.length;
    return { thread_id: threadId, post_id: post.id, published: true, prompt_version: PROMPT_VERSION };
  }
  return { thread_id: threadId, published: false, reason_codes: [], prompt_version: PROMPT_VERSION };
}

// ── 复核投票 ──
export function castVote(entryId, vote) {
  return { entry_id: entryId, worth_checking: vote === "worth_checking" ? 1 : 0, looks_right: vote === "looks_right" ? 1 : 0 };
}

// ── 分享与权限 ──
const GRANTS = {
  sb_jacaranda: [
    { user_id: "u_mel", handle: "mel_k", level: "reshare", granted_at: "2026-08-28T10:00:00+10:00" },
    { user_id: "u_dan", handle: "dan_h", level: "reshare", granted_at: "2026-08-29T18:40:00+10:00" },
    { user_id: "u_aroha", handle: "aroha_t", level: "contribute", granted_at: "2026-09-02T09:15:00+10:00" },
    { user_id: "u_sione", handle: "sione_f", level: "contribute", granted_at: "2026-09-06T20:02:00+10:00" },
    { user_id: "u_priya", handle: "priya_r", level: "view", granted_at: "2026-09-11T12:30:00+10:00" },
  ],
  sb_roof: [
    { user_id: "u_mel", handle: "mel_k", level: "reshare", granted_at: "2026-07-25T22:00:00+10:00" },
  ],
};

export function grants(storyboardId) {
  return { storyboard_id: storyboardId, owner_id: "u_mel",
           grants: (GRANTS[storyboardId] || []).map((g) => ({ ...g })) };
}

export function revokeGrant({ storyboardId, userId }) {
  GRANTS[storyboardId] = (GRANTS[storyboardId] || []).filter((g) => g.user_id !== userId);
  return { storyboard_id: storyboardId, user_id: userId, revoked: true };
}

export function issueShareLink({ storyboardId, level, expiresInDays }) {
  const days = expiresInDays || 7;
  return {
    share_link_id: "sl_" + Math.random().toString(36).slice(2, 8),
    token: "fixture-" + Math.random().toString(36).slice(2, 14),
    level,
    expires_at: new Date(Date.now() + days * 86400000).toISOString(),
    max_uses: null,
  };
}

export function redeemShareLink(token) {
  if (String(token).startsWith("fixture-")) return { storyboard_id: "sb_jacaranda", level: "contribute" };
  const error = new Error("This link doesn't work.");
  error.status = 404;
  throw error;
}
