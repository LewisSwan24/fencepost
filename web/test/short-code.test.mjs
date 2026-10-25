// Short codes (#54): three words a neighbour types in, with the square beside them.
//
//   node --import ./test/setup.mjs --test test/short-code.test.mjs
//
// Three screens: the share screen that makes one, the home page box it is typed into, and
// /c/[code] where it lands. Offline, lib/api makes the code itself and remembers which
// fixture token it stands for, because fixtures.js knows nothing about short codes.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Share from "../app/b/[id]/share/page.js";
import Home from "../app/LegacyHome.js";
import RedeemCode from "../app/c/[code]/page.js";
import { issueShareLink, shareLinks } from "../lib/api.js";
import { COPY, EXPIRY, SHORT_CODE_DAYS, SHORT_CODE_MAX_DAYS } from "../lib/copy.js";
import { renderScreen } from "./harness.mjs";
import { navigated, reset } from "./stubs/navigation.mjs";

let n = 0;
const fresh = () => "sb_code_test_" + (n += 1);
const chip = (label) => screen.queryByRole("button", { name: label });
const toggle = () => screen.getByRole("button", { name: new RegExp("^" + COPY.shortCodeOption) });

async function openShare(id) {
  await renderScreen(Share, { id });
  await waitFor(() => assert.ok(document.querySelectorAll(".person").length > 0
                                || screen.queryByText(COPY.noCodesYet)));
  return userEvent.setup();
}

const land = (code) =>
  renderScreen(RedeemCode, { heading: false, props: { params: Promise.resolve({ code }) } });

beforeEach(() => reset());
afterEach(() => cleanup());

test("asking for a short code takes away the lifetimes the server would refuse", async () => {
  const user = await openShare(fresh());
  const long = EXPIRY.filter((o) => o.id > SHORT_CODE_MAX_DAYS);
  assert.ok(long.length > 0);
  for (const o of long) assert.ok(chip(o.label), `${o.label} missing before the switch`);

  await user.click(toggle());
  assert.equal(toggle().getAttribute("aria-pressed"), "true");
  for (const o of long) assert.equal(chip(o.label), null, `${o.label} still offered`);
  // A longer pick made before the switch drops to a day as well.
  await user.click(toggle());
  await user.click(chip(long[0].label));
  await user.click(toggle());
  assert.equal(chosen(), EXPIRY.find((o) => o.id === SHORT_CODE_DAYS).label);
});

const chosen = () =>
  [...document.querySelectorAll(".chip")].find((c) => c.className.includes("chipOn")).textContent;

test("turning the short code on picks a day, and a day is what the server is asked for", async () => {
  const id = fresh();
  const user = await openShare(id);
  assert.notEqual(chosen(), EXPIRY.find((o) => o.id === SHORT_CODE_DAYS).label,
                  "the page default is already a day, so this test proves nothing");
  await user.click(toggle());
  assert.equal(chosen(), EXPIRY.find((o) => o.id === SHORT_CODE_DAYS).label);
  await user.click(screen.getByRole("button", { name: /^Make a code$/ }));
  await screen.findByRole("group", { name: COPY.shortCodeLabel });
  const { links } = await shareLinks(id);
  const coded = links.filter((l) => l.has_code);
  assert.equal(coded.length, 1);
  const days = (Date.parse(coded[0].expires_at) - Date.now()) / 86400000;
  assert.ok(days > SHORT_CODE_DAYS - 0.1 && days <= SHORT_CODE_DAYS, `lives ${days.toFixed(2)} days`);
});

test("the code is shown in words, and the square still carries the token", async () => {
  const user = await openShare(fresh());
  await user.click(toggle());
  await user.click(screen.getByRole("button", { name: /^Make a code$/ }));

  const group = await screen.findByRole("group", { name: COPY.shortCodeLabel });
  const words = group.querySelector(".wordsCode").textContent;
  assert.match(words, /^[a-z]+ [a-z]+ [a-z]+$/);
  // The square goes through the token, not /c/: scans must not share the hourly allowance
  // that every attempt at a code counts against.
  assert.match(document.querySelector(".link").textContent, /\/s\/fixture-/);
  assert.ok(screen.getByRole("img"), "no square beside the code");
  await waitFor(() => assert.match(document.querySelector(".code").textContent, new RegExp(COPY.codeHasWords)));
});

test("a code without words is unchanged: no word block, and the square carries /s/", async () => {
  const user = await openShare(fresh());
  await user.click(screen.getByRole("button", { name: /^Make a code$/ }));
  await waitFor(() => assert.ok(screen.getByRole("img")));
  assert.equal(screen.queryByRole("group", { name: COPY.shortCodeLabel }), null);
  assert.match(document.querySelector(".link").textContent, /\/s\/fixture-/);
});

test("a short code lands in the storyboard, however it was typed", async () => {
  const { short_code } = await issueShareLink({ storyboardId: "sb_jacaranda", level: "view",
                                                expiresInDays: 1, shortCode: true });
  await land(encodeURIComponent(short_code.split("-").join(" ").toUpperCase()));
  await waitFor(() => assert.deepEqual(navigated, [["replace", "/b/sb_jacaranda?via=link"]]));
});

test("a wrong code goes to /no-access like any refused link", async () => {
  await land("not-a-code");
  await waitFor(() => assert.deepEqual(navigated, [["replace", "/no-access"]]));
});

test("a stray % in the address is a wrong code, not a crash", async () => {
  await land("50%-moon");
  await waitFor(() => assert.deepEqual(navigated, [["replace", "/no-access"]]));
});

test("the home page takes a typed code to /c/", async () => {
  await renderScreen(Home);
  const user = userEvent.setup();
  const box = screen.getByLabelText(COPY.haveCode);
  assert.ok(screen.getByRole("button", { name: COPY.haveCodeGo }).disabled, "Open before anything typed");
  await user.type(box, "  Wattle Moon Possum ");
  await user.click(screen.getByRole("button", { name: COPY.haveCodeGo }));
  assert.deepEqual(navigated.at(-1), ["push", "/c/" + encodeURIComponent("Wattle Moon Possum")]);
});
