// The name screen: asked once, before anything else can go out under a random name.
//
//   node --import ./test/setup.mjs --test test/name-gate.test.mjs
//
// Three things the component's own comments say it must do:
//
//   - In a mode that really uses the name (hybrid, the delivered mode), a browser with no
//     name yet is asked *before* any child renders — child effects run first, so a child on
//     screen is a dashboard that has already minted a random guest name.
//   - It tells the truth about what you will be called: the preview carries a suffix as long
//     as the real one, and a name in another script is not quietly thrown away.
//   - It must never be the reason the site does not open. Skipping is a first-class answer,
//     and a browser that will not keep the name still gets the app.
//
// And one in the other direction: in fixtures mode it never asks at all, because there the
// identity is the fixture character mel_k, and greeting somebody by a different name than the
// one they just typed is the failure that looks like success.
//
// MODES. setup.mjs sets fixtures mode, and lib/api reads the mode once at module scope. This
// file therefore switches to hybrid before importing anything that reaches lib/api (so no
// harness.mjs, which pulls in the draft provider and lib/api with it), and checks the
// fixtures-mode rule in a child process of its own. Hybrid here makes no network request:
// NameGate only touches localStorage, and it is rendered with a plain child.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { act, render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { COPY } from "../lib/copy.js";
import { SUFFIX } from "../lib/handle.js";

process.env.NEXT_PUBLIC_FENCEPOST_MODE = "hybrid";
delete process.env.NEXT_PUBLIC_FENCEPOST_HANDLE;
const { default: NameGate } = await import("../components/NameGate.js");

const KEY = "fencepost.handle";
const APP = "the app itself";

const field = () => screen.getByLabelText(COPY.nameLabel);
const go = () => screen.getByRole("button", { name: COPY.nameGo });
const skip = () => screen.getByRole("button", { name: COPY.nameSkip });
const appOpen = () => screen.queryByText(APP);

async function open() {
  await act(async () => { render(<NameGate><p>{APP}</p></NameGate>); });
  return userEvent.setup({ document });
}

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

test("a browser with no name is asked first, and nothing behind the gate renders", async () => {
  // Children render only after the name is settled; a child on screen here would already
  // have sent its first request under a random guest name.
  await open();
  assert.ok(screen.getByRole("heading", { level: 1, name: COPY.nameTitle }));
  assert.equal(appOpen(), null, "the app rendered underneath the question");
  assert.equal(window.localStorage.getItem(KEY), null, "a name was minted before anyone answered");
});

test("a browser that already has a name is not asked again", async () => {
  // Asked once, on the first visit. Asking again would invite changing the handle, which
  // makes you a different user whose sightings do not come along.
  window.localStorage.setItem(KEY, "sam-1a2b3c4d");
  await open();
  assert.ok(appOpen());
  assert.equal(screen.queryByText(COPY.nameTitle), null);
});

test("the preview shows the name as it will really be, suffix and all", async () => {
  // The screen's whole job is to say what somebody is about to be called; the placeholder
  // suffix is as long as the real one, so the preview cannot show a shorter name.
  const user = await open();
  await user.type(field(), "Sam from #14");
  assert.ok(screen.getByText(`@sam_from_14-${"x".repeat(SUFFIX)}`));
  assert.ok(screen.getByText(COPY.nameWhySuffix));
});

test("a name in another script is kept, not swapped for a random one", async () => {
  // handle.js: stripping to ASCII would hand anyone writing their name in Chinese or
  // Cyrillic the guest name instead — the judgement the screener is forbidden to make.
  const user = await open();
  await user.type(field(), "李明");
  assert.ok(screen.getByText(`@李明-${"x".repeat(SUFFIX)}`));
  assert.equal(go().disabled, false);
});

test("a name with nothing usable in it cannot be kept, but skip is still there", async () => {
  // No preview means no handle; the button waits. Nobody is stuck, though — skip is a
  // first-class answer, always offered.
  const user = await open();
  assert.equal(go().disabled, true);
  await user.type(field(), "!!! ###");
  assert.equal(go().disabled, true);
  assert.equal(screen.queryByText(COPY.nameWhySuffix), null);
  assert.equal(skip().disabled, false);
});

test("keeping a name stores that handle and opens the app", async () => {
  // The suffix is the part that cannot be dropped: without it two Sams share an identity
  // and can edit each other's sightings. The real one is drawn at keep time, eight hex long.
  const user = await open();
  await user.type(field(), "Sam");
  await user.click(go());
  assert.ok(appOpen());
  assert.match(window.localStorage.getItem(KEY), new RegExp(`^sam-[0-9a-f]{${SUFFIX}}$`));
});

test("skipping gives the random name and opens the app", async () => {
  // Would rather not be named on a screen about who can see what: a reasonable choice, and
  // it lands on the guest name everybody had before, not on a dead end.
  const user = await open();
  await user.click(skip());
  assert.ok(appOpen());
  assert.match(window.localStorage.getItem(KEY), /^guest_[0-9a-f]+$/);
});

test("a browser that will not keep the name still gets the app", async () => {
  // Never the reason the site does not open. Storage that accepts a write and drops it is
  // real (full quota, locked-down webviews); chooseHandle answers null and the gate opens.
  const proto = Object.getPrototypeOf(window.localStorage);
  const realSet = proto.setItem;
  proto.setItem = function () {};
  try {
    const user = await open();
    await user.type(field(), "Sam");
    await user.click(go());
    assert.ok(appOpen(), "the gate stayed shut because storage did not keep the name");
  } finally {
    proto.setItem = realSet;
  }
});

test("storage that throws on read still opens onto the question, not a blank page", async () => {
  // Every failure path renders something usable: a throwing localStorage reads as "no name
  // yet", and skipping from there opens the app.
  const proto = Object.getPrototypeOf(window.localStorage);
  const realGet = proto.getItem;
  proto.getItem = function () { throw new Error("SecurityError"); };
  try {
    const user = await open();
    assert.ok(screen.getByText(COPY.nameTitle));
    await user.click(skip());
    assert.ok(appOpen());
  } finally {
    proto.getItem = realGet;
  }
});

test("in fixtures mode it never asks, because the name would not be used", async () => {
  // NameGate's own comment: offline, me() answers as mel_k whatever was typed. Asking and
  // then greeting somebody by another name is worse than not asking. Run in a child process,
  // because this process has already loaded lib/api in hybrid mode.
  const web = fileURLToPath(new URL("..", import.meta.url));
  const script = `
    process.env.NEXT_PUBLIC_FENCEPOST_MODE = "fixtures";
    const React = await import("react");
    const { act, render, screen } = await import("@testing-library/react");
    const { default: NameGate } = await import("./components/NameGate.js");
    await act(async () => {
      render(React.createElement(NameGate, null, React.createElement("p", null, "APP_OPEN")));
    });
    const asked = document.body.textContent.includes(${JSON.stringify(COPY.nameTitle)});
    const opened = !!screen.queryByText("APP_OPEN");
    console.log(JSON.stringify({ asked, opened, stored: window.localStorage.getItem("${KEY}") }));
  `;
  const run = spawnSync(process.execPath,
    ["--import", "./test/setup.mjs", "--input-type=module", "-e", script],
    { cwd: web, encoding: "utf8", timeout: 60000 });
  const line = (run.stdout || "").trim().split("\n").pop();
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(line), { asked: false, opened: true, stored: null });
});
