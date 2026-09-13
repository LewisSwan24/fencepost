// node --test lib/fixtures.test.mjs
//
// 这组用例是有来历的：other_animal 那条正则曾经因为字符串里少转义一层，
// 写出来是退格符而不是词边界，安安静静地永远不匹配——四条演示脚本里的
// bandicoot 那条当场就废了，而界面上看起来只是「助手说它不知道」。
// 所以每条路由都钉一个用例。
import { test } from "node:test";
import assert from "node:assert/strict";
import { assistantReply, assistantFrames, writer, suggestedSpecies, PROMPT_VERSION } from "./fixtures.js";

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
