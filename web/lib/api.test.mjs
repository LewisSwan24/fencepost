// node --test lib/api.test.mjs
//
// 钉的是**访客的身分**。
//
// 原先所有访客共用一个 handle，`author_id` 在他们之间相等：访客 A 能改能删访客 B
// 写的条目。owner 那一层挡住了，访客彼此之间没有。
//
// 还有一条更要紧的：`NEXT_PUBLIC_FENCEPOST_HANDLE` 的默认值曾经是 `mel_k`，
// 而那是 demo 故事版的 owner——谁忘了配这个变量，每位访客就都成了 owner。
//
// 每条用例都 import 一份**新的**模块实例（靠查询串绕开缓存）：handle 会缓存在
// 模块级变量里，共用一份的话后一条测的是前一条留下的状态。

import { test } from "node:test";
import assert from "node:assert/strict";

let seq = 0;

// 装好 window / crypto 的桩，再拿一份干净的 api.js
async function freshApi({ store = {}, crypto, brokenStorage = false } = {}) {
  globalThis.window = {
    localStorage: brokenStorage
      ? { getItem() { throw new Error("SecurityError"); },
          setItem() { throw new Error("SecurityError"); } }
      : { getItem: (k) => (k in store ? store[k] : null),
          setItem: (k, v) => { store[k] = String(v); } },
  };
  // Node 的 globalThis.crypto 是只读 getter，直接赋值不生效，得 defineProperty。
  if (crypto !== undefined) {
    Object.defineProperty(globalThis, "crypto", { value: crypto, configurable: true, writable: true });
  }
  seq += 1;
  return import(`./api.js?case=${seq}`);
}

test("没配固定 handle 时，默认值不是 mel_k", async () => {
  // 回归测试。默认值退回 owner 的那一版，等于把 owner 权限发给所有访客——
  // 而这种错不会报错，只会安安静静把 demo 的控制权送出去。
  const api = await freshApi();
  assert.notEqual(api.HANDLE, "mel_k");
  assert.equal(api.HANDLE, "");
});

test("每个浏览器拿到自己的 handle，并且记住它", async () => {
  const store = {};
  const api = await freshApi({ store });
  const first = api.visitorHandle();
  assert.match(first, /^guest_[0-9a-f]{16}$/);
  assert.equal(store["fencepost.handle"], first);
  // 同一个浏览器再问一次还是同一个人——自己写的条目才还归自己
  assert.equal(api.visitorHandle(), first);
});

test("两个浏览器拿到的是两个人", async () => {
  // 这就是这次改动的全部意义：他们不再是同一个用户。
  // 每份模块取完自己的 handle 再装下一份：globalThis.window 是共用的，
  // 先装两份再取的话，第一份读到的是第二份的 store。
  const first = (await freshApi({ store: {} })).visitorHandle();
  const second = (await freshApi({ store: {} })).visitorHandle();
  assert.notEqual(first, second);
});

test("handle 走的是 CSPRNG，不是 Math.random", async () => {
  // 开放注册下「知道一个 handle」就等于「能以那个人登录」，所以这个值不该出自
  // 一个看几个输出就能反推状态的 PRNG（V8 的 Math.random 是 xorshift128+）。
  const seen = [];
  const api = await freshApi({
    store: {},
    crypto: {
      getRandomValues(arr) {
        seen.push(arr.length);
        for (let i = 0; i < arr.length; i++) arr[i] = 0xab;
        return arr;
      },
    },
  });
  const h = api.visitorHandle();
  assert.deepEqual(seen, [8], "没有调用 crypto.getRandomValues");
  assert.equal(h, "guest_" + "ab".repeat(8));
});

test("handle 落在服务端接受的长度里", async () => {
  // 服务端：空、纯空白、超过 40 字符都会被 400 挡回来
  const api = await freshApi({ store: {} });
  const h = api.visitorHandle();
  assert.ok(h.trim().length > 0);
  assert.ok(h.length <= 40);
});

test("localStorage 用不了也不能崩，也不能每次换一个人", async () => {
  // 无痕模式下 getItem/setItem 会抛。这一次浏览里至少还得是同一个身分，
  // 否则每个请求都是新用户，连自己刚发的东西都不认得。
  const api = await freshApi({ brokenStorage: true });
  const a = api.visitorHandle();
  const b = api.visitorHandle();
  assert.match(a, /^guest_/);
  assert.equal(a, b, "同一次会话里换了身分");
});
