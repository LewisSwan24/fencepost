// 钉住作者被拦下时读到的那句话。
//
//   node --test lib/copy.test.mjs
//
// 为什么值得单独一个文件：这些句子是 ux-copy.md §1 的逐字搬运，而 §1 不在仓库里
// （CLAUDE.md：docs/ 不进仓库），所以没有任何自动手段能发现「搬错了」。
// 这个文件就是那道人工对照留下的痕迹——2026-09-14 对照时发现三处不一致：
// 配了两个 Screener 根本不发的码（safety、scope），漏了五个真会发的，
// 兜底那句也是另写的。被拦下的人读到什么，是这个产品最要紧的几句话之一。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { COPY, REASON_COPY, REASON_FALLBACK, reasonSentence } from "./copy.js";

const WEB = dirname(dirname(fileURLToPath(import.meta.url)));

function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (name.endsWith(".js")) out.push(full);
  }
  return out;
}

test("界面引用到的每个 COPY 键都真的存在", () => {
  // 这条是踩出来的：复核队列那一屏引用了 COPY.votedYes / COPY.votedNo，而 copy.js 里
  // 从来没有这两个键。React 把 undefined 渲染成空——投完票之后按钮消失、一个字都没有，
  // 而且不报错。别的测试一个都抓不到，因为逻辑是对的，缺的只是一个键。
  const missing = [];
  for (const file of [...sourceFiles(join(WEB, "app")), ...sourceFiles(join(WEB, "components"))]) {
    const text = readFileSync(file, "utf8");
    for (const [, key] of text.matchAll(/\bCOPY\.([A-Za-z_$][\w$]*)/g)) {
      if (!(key in COPY)) missing.push(`${file.slice(WEB.length + 1)} → COPY.${key}`);
    }
  }
  assert.deepEqual(missing, [], "引用了不存在的文案键，界面上那处会是一片空白");
});

test("COPY 里没有空值", () => {
  for (const [key, value] of Object.entries(COPY)) {
    assert.ok(value !== undefined && value !== null && value !== "", `COPY.${key} 是空的`);
  }
});

// prompts.md §4.2 的封闭集合。模型只会从这里面挑。
const EMITTED = [
  "nonsense", "abuse", "spam", "pii", "harm_advocacy", "dangerous_reassurance",
  "fact_conflict", "unverifiable_number", "handling_advice", "legal_claim", "injection",
];

test("每个配了文案的键，都是 Screener 真会发出来的码", () => {
  for (const key of Object.keys(REASON_COPY)) {
    assert.ok(EMITTED.includes(key),
      `REASON_COPY 里的 ${key} 不在 prompts.md §4.2 的集合里——配了也永远不会命中`);
  }
});

test("ux-copy §1 列出的六个码都有自己的句子", () => {
  for (const key of ["nonsense", "pii", "abuse", "spam", "harm_advocacy", "dangerous_reassurance"]) {
    assert.ok(REASON_COPY[key], `${key} 没有文案，会掉进兜底`);
  }
});

test("按 codes 取第一条匹配的，不是把它们拼起来", () => {
  const two = reasonSentence(["harm_advocacy", "pii"]);
  assert.equal(two, REASON_COPY.harm_advocacy);
  assert.ok(!two.includes("address or name"), "两句话叠在一起了");
});

test("前面的码没有文案时，往后找", () => {
  // fact_conflict 没有面向作者的文案，这是故意的；后面的 pii 有。
  assert.equal(reasonSentence(["fact_conflict", "pii"]), REASON_COPY.pii);
});

test("一个都匹配不上就走兜底", () => {
  assert.equal(reasonSentence(["fact_conflict"]), REASON_FALLBACK);
  assert.equal(reasonSentence(["injection"]), REASON_FALLBACK);
});

test("codes 是空的、没给、或者不是数组，也得有话说", () => {
  assert.equal(reasonSentence([]), REASON_FALLBACK);
  assert.equal(reasonSentence(undefined), REASON_FALLBACK);
  assert.equal(reasonSentence(null), REASON_FALLBACK);
});

test("兜底那句说了「东西还在」", () => {
  // 这不是文风问题。用户刚写完一段话被拦下，第一反应是「我写的没了吗」。
  assert.ok(/nothing has been lost/i.test(REASON_FALLBACK));
});

test("没有一句话在指责写的人", () => {
  // Screener 不判文采与价值（CLAUDE.md 决策表），文案也不该。
  const forbidden = /\b(violat|illegal|banned|invalid|wrong|failed|rejected)\b/i;
  for (const [key, line] of Object.entries({ ...REASON_COPY, fallback: REASON_FALLBACK })) {
    assert.ok(!forbidden.test(line), `${key} 读起来像在判人：${line}`);
  }
});
