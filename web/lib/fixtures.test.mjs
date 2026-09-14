// node --test lib/fixtures.test.mjs
//
// 这组用例是有来历的：other_animal 那条正则曾经因为字符串里少转义一层，
// 写出来是退格符而不是词边界，安安静静地永远不匹配——四条演示脚本里的
// bandicoot 那条当场就废了，而界面上看起来只是「助手说它不知道」。
// 所以每条路由都钉一个用例。
import { test } from "node:test";
import assert from "node:assert/strict";
import { assistantReply, assistantFrames, writer, suggestedSpecies, PROMPT_VERSION,
         createThread, createPost, boardAccess, editEntry, deleteEntry,
         timeline, dashboard, closeStoryboard, reviewQueue, castVote, disposeEntry,
         shareLinks, revokeShareLink, grants, BLOCKED_TRIGGER } from "./fixtures.js";

const CASES = [
  ["How do I catch the possum in my roof?", "licensed operator"],
  ["I filmed a bandicoot digging up the lawn, what is it doing?", "Possums are all I know about"],
  ["There's a brown snake on my patio, what do I do?", "won't guess at a snake"],
  ["What did the other people write in this storyboard?", "can't see anyone else"],
  ["a bandicoot is on the lawn", "Possums are all I know about"],
  ["Will it hurt my cat?", "can't tell how badly hurt"],
  ["Do they eat fruit?", "mostly leaf eaters"],
  ["Can I leave out some fruit for it?", "Best not to"],
  ["There is a bat on my fence", "vaccinated handlers"],
  ["Is it a brushtail or a ringtail?", "won't call it either way"],
  ["What time do they usually come out?", "only got a few answers"],
];

for (const [question, expected] of CASES) {
  test(question, () => {
    const reply = assistantReply(question).reply;
    assert.ok(reply.includes(expected), `想要包含「${expected}」，实际是「${reply}」`);
  });
}

test("蝙蝠那条给号码，也给接种那句，并且明确拒绝评论安全性", () => {
  const { reply } = assistantReply("there's a bat stuck in my carport");
  assert.ok(reply.includes("1300 264 625"), "号码要给数字形式，不能只给助记词");
  assert.ok(reply.includes("Only vaccinated handlers should touch a bat"));
  assert.ok(reply.includes("won't say anything about whether one is safe"));
  assert.ok(reply.includes("don't pick it up"));
  // 这里不做「不许出现 safe 这个词」的反向断言：这条回复里的 safe 恰恰在拒绝语里
  // （won't say anything about whether one is safe），关键词查会把正确的拒绝判成违规。
  // 正则分不清「X 是安全的」和「我不会说 X 安不安全」，硬凑只会得到假信心。
  // 「永不下无毒/安全结论」这条红线由 prompt 与 tests/redline_cases.yaml 守，不由这里守。
});

test("每条回复都带版本号", () => {
  assert.equal(assistantReply("anything").prompt_version, PROMPT_VERSION);
});

test("流式帧的形状和真代理一致", () => {
  const frames = assistantFrames("Do they eat fruit?");
  assert.equal(frames[0].prompt_version, PROMPT_VERSION);
  assert.equal(frames.at(-1).done, true);
  assert.ok(frames.slice(1, -1).every((f) => typeof f.delta === "string"));
});

test("Writer 只给候选，两种把握度各一条", () => {
  const out = writer("ringtail", "saw one on the fence");
  assert.equal(out.fun_facts.length, 2);
  assert.deepEqual(out.fun_facts.map((f) => f.confidence), ["established", "unverified"]);
  assert.equal(out.skipped, false);
  assert.ok(!("verdict" in out) && !("note" in out));
});

test("不是负鼠就没有 fun fact，skipped 为真", () => {
  assert.equal(writer("other", "something in the tree").skipped, true);
  assert.equal(writer("unknown", "not sure what it was").fun_facts.length, 0);
});

test("认帧的建议是句子，不是选中项", () => {
  assert.equal(suggestedSpecies("Looks most like a Brushtail — going by the bushy tail."), "brushtail");
  // 同时提到两种，或者一种都没提，就不给「Use this」——宁可不给，也不替用户选
  assert.equal(suggestedSpecies("Could be a brushtail or a ringtail from this angle."), null);
  assert.equal(suggestedSpecies("Too dark to say."), null);
});

// ── 论坛（离线）──
// 这几条是 CRUD，不是助手路由。放在这里是因为它们钉的是同一件事：
// 离线演示必须演得出线上真会发生的事，否则 fixtures 模式就是一份粉饰。

test("标题里写了地址，正文再干净也发不出去", () => {
  // 这正是「标题跟正文一起过筛查」那次改动要挡的东西。
  const out = createThread({
    storyboardId: "sb_jacaranda",
    title: `Anyone seen the one at ${BLOCKED_TRIGGER}`,
    body: "it comes along the fence about eleven most nights",
  });
  assert.equal(out.published, false);
  assert.deepEqual(out.reason_codes, ["pii"]);
  assert.ok(!("thread_id" in out), "被拒时不该给 thread_id —— 界面会拿它去跳转");
});

test("正文里写了地址也一样", () => {
  const out = createThread({
    storyboardId: "sb_jacaranda", title: "Who else hears it at 2am",
    body: `it lives under the deck at ${BLOCKED_TRIGGER}`,
  });
  assert.equal(out.published, false);
});

test("干净的主题能发出去，并且带着 thread_id", () => {
  const out = createThread({
    storyboardId: "sb_jacaranda", title: "Who else hears it at 2am",
    body: "something walks on my roof every night",
  });
  assert.equal(out.published, true);
  assert.ok(out.thread_id);
});

test("回复里的地址也拦得住", () => {
  assert.equal(createPost({ threadId: "t1", body: `round the back of ${BLOCKED_TRIGGER}` }).published, false);
});

test("能不能写，照故事版的档位和状态说了算", () => {
  // sb_jacaranda 是 reshare 且 active；sb_roof 是 view 且 archived。
  assert.deepEqual(boardAccess("sb_jacaranda"), { level: "reshare", status: "active" });
  assert.deepEqual(boardAccess("sb_roof"), { level: "view", status: "archived" });
  assert.deepEqual(boardAccess("nope"), { level: null, status: null });
});

// ── 改与删自己的条目（离线）──

test("改动被拒时，库里那一条一个字都不能动", () => {
  const before = timeline("sb_jacaranda").entries.find((e) => e.id === "e5");
  const original = before.story;
  const out = editEntry({ entry_id: "e5", story: `it lives at ${BLOCKED_TRIGGER}` });
  assert.equal(out.published, false);
  assert.deepEqual(out.reason_codes, ["pii"]);
  const after = timeline("sb_jacaranda").entries.find((e) => e.id === "e5");
  assert.equal(after.story, original, "被拒却把原文改掉了 —— 这是最坏的一种结果");
});

test("什么都没改，回 unchanged，不假装保存过", () => {
  const row = timeline("sb_jacaranda").entries.find((e) => e.id === "e5");
  const out = editEntry({ entry_id: "e5", story: row.story, fun_fact: row.fun_fact });
  assert.equal(out.unchanged, true);
});

test("改得动的时候就真的改了", () => {
  const out = editEntry({ entry_id: "e4", story: "came back the next night too" });
  assert.equal(out.published, true);
  assert.ok(!out.unchanged);
  const row = timeline("sb_jacaranda").entries.find((e) => e.id === "e4");
  assert.equal(row.story, "came back the next night too");
});

test("删掉一条，计数和封面物种跟着一起变", () => {
  const boardBefore = dashboard().active.find((b) => b.id === "sb_jacaranda");
  const countBefore = boardBefore.entry_count;
  const newest = timeline("sb_jacaranda").entries[0];
  const out = deleteEntry(newest.id);
  assert.equal(out.deleted, true);
  const view = timeline("sb_jacaranda");
  assert.ok(!view.entries.some((e) => e.id === newest.id));
  const boardAfter = dashboard().active.find((b) => b.id === "sb_jacaranda");
  assert.equal(boardAfter.entry_count, countBefore - 1);
  assert.equal(boardAfter.latest_species, view.entries[0]?.species ?? null,
               "封面按最近一条配图，删掉最新那条之后要跟着换");
});

// ── owner 完结（离线）──

test("完结之后进往期，并且结语读得回来", () => {
  const out = closeStoryboard({ storyboard_id: "sb_jacaranda",
                                closed_note: "Thanks for filming with me, everyone." });
  assert.equal(out.status, "archived");
  const boards = dashboard();
  assert.ok(!boards.active.some((b) => b.id === "sb_jacaranda"));
  const past = boards.past.find((b) => b.id === "sb_jacaranda");
  assert.equal(past.closed_note, "Thanks for filming with me, everyone.",
               "结语只写不读的话，那句「留给所有参与过的人」就是空话");
});

test("不写结语就是没有结语，不是一个空字符串", () => {
  closeStoryboard({ storyboard_id: "sb_roof", closed_note: undefined });
  const past = dashboard().past.find((b) => b.id === "sb_roof");
  assert.equal(past.closed_note, null);
});

// ── 待核实队列（离线）──

test("队列里一个作者身分都没有", () => {
  // 这不是界面藏起来的：服务端返回的字段里就没有。三条红线里最要紧的一条。
  const { items } = reviewQueue("sb_jacaranda");
  assert.ok(items.length > 0);
  for (const item of items) {
    assert.ok(!("handle" in item), "队列里出现了 handle");
    assert.ok(!("author_id" in item), "队列里出现了 author_id");
    assert.ok(!("voter_id" in item), "队列里出现了投票人");
    assert.ok(!JSON.stringify(item).includes("mel_k"), "有 handle 从别的字段漏出来了");
  }
});

test("两票 worth_checking 之后，它从队列里消失", () => {
  const before = reviewQueue("sb_jacaranda").items.length;
  const target = reviewQueue("sb_jacaranda").items[0].entry_id;
  castVote(target, "worth_checking");
  assert.equal(reviewQueue("sb_jacaranda").items.length, before, "一票还不该定音");
  castVote(target, "worth_checking");
  assert.equal(reviewQueue("sb_jacaranda").items.length, before - 1,
               "两票定音之后该落到 labelled，不再挂在队列上");
});

test("owner 处置掉的条目不再排队", () => {
  const { items } = reviewQueue("sb_jacaranda");
  if (!items.length) return;                       // 上一条可能已经清空了
  const target = items[0].entry_id;
  disposeEntry(target, "kept");
  assert.ok(!reviewQueue("sb_jacaranda").items.some((i) => i.entry_id === target));
});

// ── 已发出去的码（离线）──

test("码的列表里永远没有 token", () => {
  // 库里只存哈希。一个事后还能把码取回来的界面，等于把可兑换的权限挂在屏幕上。
  const { links } = shareLinks("sb_jacaranda");
  assert.ok(links.length > 0);
  for (const link of links) {
    assert.ok(!("token" in link), "列表里出现了 token");
    assert.ok(!("token_hash" in link), "列表里出现了 token_hash");
  }
});

test("列表里说不出「什么时候发的」——那一列根本不存在", () => {
  for (const link of shareLinks("sb_jacaranda").links) {
    assert.ok(!("created_at" in link),
      "share_links 表没有 created_at，凭空多出来就是界面在编");
  }
});

test("关掉一张码，不动任何已经兑换出去的权限", () => {
  // 这是整段文案要说清楚的那件事，也是最容易做错的一处。
  const before = grants("sb_jacaranda").grants.map((g) => g.user_id + ":" + g.level);
  const target = shareLinks("sb_jacaranda").links.find((l) => !l.revoked_at);
  const out = revokeShareLink(target.id);
  assert.equal(out.revoked, true);
  const after = grants("sb_jacaranda").grants.map((g) => g.user_id + ":" + g.level);
  assert.deepEqual(after, before, "关码顺手改了权限名单 —— 那是另一件事");
});

test("关掉之后它还留在列表里，带着「已关掉」", () => {
  // 和 grants 相反：撤销的人要从名单上消失，关掉的码得留着，否则看不出关成了没有。
  const target = shareLinks("sb_jacaranda").links.find((l) => !l.revoked_at);
  revokeShareLink(target.id);
  const again = shareLinks("sb_jacaranda").links.find((l) => l.id === target.id);
  assert.ok(again, "关掉之后它从列表里消失了");
  assert.ok(again.revoked_at);
});
