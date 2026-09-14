// node --test lib/format.test.mjs
//
// relative() 是往回看的，until() 是往前看的。把它们弄混的后果不是难看：
// 分享页用 relative() 显示码的有效期，于是每一张还没过期的码都写着「Expires today」，
// 连一张六周后才到期的也一样。2026-09-14 在本机看出来的。

import { test } from "node:test";
import assert from "node:assert/strict";
import { until, relative } from "./format.js";

const NOW = new Date("2026-09-14T12:00:00+10:00");

test("往前看：今天、明天、这周内、更远", () => {
  assert.equal(until("2026-09-14T23:00:00+10:00", NOW), "today");
  assert.equal(until("2026-09-15T09:00:00+10:00", NOW), "tomorrow");
  assert.equal(until("2026-09-19T09:00:00+10:00", NOW), "in 5 days");
  assert.equal(until("2026-10-30T09:00:00+10:00", NOW), "30 Oct");
});

test("已经过去的就说过去了，不说 today", () => {
  assert.equal(until("2026-09-12T09:00:00+10:00", NOW), "expired");
});

test("没有有效期就是空字符串，不是 Invalid Date", () => {
  assert.equal(until(null, NOW), "");
  assert.equal(until(undefined, NOW), "");
});

test("relative() 对未来时间确实会塌成 today —— 所以有效期不能用它", () => {
  // 这条钉的是「为什么需要 until()」。relative() 本身没坏，它只是往回看的。
  assert.equal(relative("2026-10-30T09:00:00+10:00", NOW), "today");
  assert.notEqual(until("2026-10-30T09:00:00+10:00", NOW), "today");
});
