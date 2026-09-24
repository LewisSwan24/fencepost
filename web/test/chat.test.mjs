// 10 · Possum Help, and the red lines it can show on a screen.
//
//   node --import ./test/setup.mjs --test test/chat.test.mjs
//
// The demo delivers the assistant from fixtures, never from a live model (CLAUDE.md decision
// table: a real model can cross a red line in the room and there is no second go). So what
// this suite pins is what the screen does with those fixed answers, and what it must never be:
//
//   - a functional label, not a persona: "Possum Help", no avatar, no name bubble, no typing
//     animation, and the AI disclosure is always the first thing said;
//   - honest that nothing is generated live, even for somebody who never saw the home page;
//   - never an identifier of snakes or bats, and never the one to call either safe;
//   - without write powers: it cannot add, invite, share or grant, and says so;
//   - Tier 1: it cannot see anybody else's entries;
//   - when it fails, it degrades to the offline line rather than fabricating a reply.
//
// Unreachable here, stated rather than forced: the frame-consent sheet. Chat has no image
// path at all — a frame reaches the assistant only from the add flow's consent sheet
// (COPY.consentTitle). What this component can promise is that it offers no way round that
// sheet, which is what the "no attachment" test pins.
//
// assistantOffline and assistantIsLive are read once at module scope from the environment,
// so the offline *start* cannot be rendered in this process; the offline line is reached
// through the failure path instead, which is the one that matters more (prompts.md §5).

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { act, render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Chat from "../components/Chat.js";
import { COPY } from "../lib/copy.js";
import { ASSISTANT_DISCLOSURE, ASSISTANT_SCRIPT } from "../lib/fixtures.js";

const script = (key) => ASSISTANT_SCRIPT.find((s) => s.key === key);
const box = () => screen.getByLabelText("Ask Possum Help");
const send = () => screen.getByRole("button", { name: "Send" });
// The fixture reply arrives after a 650 ms pause, so every wait for an answer is longer
// than waitFor's one-second default leaves comfortable.
const answer = (text) => screen.findByText(text, {}, { timeout: 3000 });

// "Calling it safe" in the forms an answer would actually use. Deliberately not the bare
// word: the bat line says it *won't* say whether one is safe, which is the rule, not a breach.
const CALLS_IT_SAFE =
  /\b(harmless|non-?venomous|not venomous|not dangerous|(it'?s|it is|they'?re|they are) (safe|fine|ok|okay))\b/i;

async function open() {
  await act(async () => { render(<Chat storyboardId="sb_jacaranda" onClose={() => {}} />); });
  return userEvent.setup({ document });
}

async function ask(user, question) {
  await user.type(box(), question);
  await user.click(send());
}

// jsdom does no layout, so it has no scrollIntoView; the log calls it on every new turn.
// Installed for this file only and taken away afterwards.
let hadScroll;
before(() => {
  hadScroll = Object.prototype.hasOwnProperty.call(Element.prototype, "scrollIntoView");
  if (!hadScroll) Element.prototype.scrollIntoView = function () {};
});
after(() => { if (!hadScroll) delete Element.prototype.scrollIntoView; });

afterEach(() => cleanup());

test("it is labelled Possum Help and opens by saying it is an AI, not a person", async () => {
  // Functional label, not a persona (CLAUDE.md): the heading is the tool's name and the
  // disclosure is the first thing in the conversation, before anything is asked.
  await open();
  assert.equal(screen.getByRole("heading", { level: 2 }).textContent.trim(), "Possum Help");
  const dialog = screen.getByRole("dialog");
  assert.match(dialog.textContent, /I'm an AI assistant, not a person/);
  assert.ok(screen.getByText(ASSISTANT_DISCLOSURE.lead, { selector: "strong" }));
});

test("there is no avatar, no picture of anybody and no typing animation", async () => {
  // Header comment: no avatar, no name bubble, no anthropomorphic typing. The only graphic
  // on the sheet is the send arrow, and that is hidden from assistive tech.
  const user = await open();
  const dialog = screen.getByRole("dialog");
  assert.equal(dialog.querySelectorAll("img, picture, [role=img]").length, 0, "an avatar appeared");
  for (const svg of dialog.querySelectorAll("svg")) {
    assert.equal(svg.getAttribute("aria-hidden"), "true");
  }

  await user.click(screen.getByRole("button", { name: script("roof").question }));
  // While waiting it is "Working" — a tool at work, not somebody typing.
  assert.ok(screen.getByText("Working"));
  assert.doesNotMatch(dialog.textContent, /typing/i);
  await answer(script("roof").reply);
});

test("it says the answers are pre-written, inside the conversation itself", async () => {
  // The demo is hybrid with the assistant on fixtures. Somebody who opens a storyboard
  // directly never sees the home page footer, so the sheet has to say it on its own.
  await open();
  assert.ok(screen.getByText(COPY.assistantCanned));
});

test("the demo questions are offered, and a tapped one gets its scripted answer", async () => {
  // The four scripts are tappable to save typing them in the room; the reply is word for
  // word from the fixed-response section, nothing rewritten.
  const user = await open();
  for (const s of ASSISTANT_SCRIPT) assert.ok(screen.getByRole("button", { name: s.question }));

  await user.click(screen.getByRole("button", { name: script("roof").question }));
  await answer(script("roof").reply);
  // The disclosure stays above the conversation rather than scrolling out of order.
  const disclosure = screen.getByText(ASSISTANT_DISCLOSURE.lead, { selector: "strong" });
  const asked = screen.getByText(script("roof").question);
  assert.ok(disclosure.compareDocumentPosition(asked) & Node.DOCUMENT_POSITION_FOLLOWING,
            "something was said before the AI disclosure");
  assert.equal(screen.queryByRole("button", { name: script("snake").question }), null,
               "the chips stayed up after the conversation started");
});

test("a snake gets distance and a catcher, never a name and never 'safe'", async () => {
  // Red line: snakes are never identified and never called harmless, not even when the
  // person names the species themselves.
  const user = await open();
  await user.click(screen.getByRole("button", { name: script("snake").question }));
  const reply = await answer(script("snake").reply);
  assert.doesNotMatch(reply.textContent, CALLS_IT_SAFE);
  assert.doesNotMatch(reply.textContent, /\bbrown\b/i, "it repeated the species back as if confirmed");
  assert.match(reply.textContent, /snake catcher/);
  assert.match(reply.textContent, /000/);
});

test("naming the species does not get it identified either", async () => {
  // shared.txt: never identify a snake even when the user offers a name — the route list
  // exists to catch the naming, not to do the identifying.
  const user = await open();
  await ask(user, "Is it a taipan or a python?");
  const reply = await answer(script("snake").reply);
  assert.doesNotMatch(reply.textContent, /taipan|python/i);
  assert.doesNotMatch(reply.textContent, CALLS_IT_SAFE);
});

test("a bat is never called safe, and nobody is told to pick it up", async () => {
  // Red line: bats are never identified or declared safe; only vaccinated handlers touch
  // one, and the number goes out with its hours.
  const user = await open();
  await ask(user, "There's a microbat in the shed, is it harmless?");
  const reply = await answer(/Bats are outside what I cover/);
  assert.doesNotMatch(reply.textContent, CALLS_IT_SAFE);
  assert.match(reply.textContent, /don't pick it up/);
  assert.match(reply.textContent, /vaccinated/);
  assert.match(reply.textContent, /7am to 7pm/);
});

test("an animal nobody listed is not offered an identification", async () => {
  // The fallback once offered to identify anything from its tail — so a taipan or a
  // microbat that slipped the routes got exactly what shared.txt forbids.
  const user = await open();
  await ask(user, "What is this green thing on my fence?");
  const reply = await answer(/I won't try to identify anything else/);
  assert.doesNotMatch(reply.textContent, /\btail\b/i);
});

test("it cannot invite, share or grant anything, and points at the control instead", async () => {
  // No write powers, no tool use (CLAUDE.md): asked to share, it says that part is yours.
  const user = await open();
  await ask(user, "Can you invite my neighbour to this?");
  await answer(/I can't share a storyboard or invite anyone/);

  // And the sheet itself offers nothing that writes: once the chips go, the only control
  // is the send button.
  const buttons = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") || b.textContent);
  assert.deepEqual(buttons, ["Send"]);
});

test("it offers no way to attach a frame, so nothing bypasses the consent sheet", async () => {
  // A frame reaches an AI service only after "Send this frame for identification?"; the
  // conversation must not be a second door that skips it.
  await open();
  const dialog = screen.getByRole("dialog");
  assert.equal(dialog.querySelectorAll("input[type=file], video, canvas").length, 0);
  assert.equal(screen.queryByText(COPY.consentTitle), null);
});

test("it says it cannot see anybody else's entries", async () => {
  // Tier 1: the assistant's context is the requester's own content only.
  const user = await open();
  await user.click(screen.getByRole("button", { name: script("others").question }));
  await answer(script("others").reply);
});

test("a blank question is not sent", async () => {
  // Nothing to ask means no turn in the log and no request.
  const user = await open();
  assert.equal(send().disabled, true);
  await user.type(box(), "   ");
  assert.equal(send().disabled, true);
  assert.ok(screen.getByRole("button", { name: script("roof").question }),
            "a whitespace question started a conversation");
});

test("when the assistant fails it goes offline rather than making something up", async () => {
  // prompts.md §5: degrade rather than fabricate; half an answer is a fabrication too.
  // The fixture path cannot fail on its own, so the 650 ms reply timer is made to throw —
  // askAssistant then rejects exactly as a dead network would.
  const real = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) => {
    if (ms === 650) throw new Error("the assistant is down");
    return real(fn, ms, ...rest);
  };
  try {
    const user = await open();
    await ask(user, "What do they eat?");
    await waitFor(() => assert.ok(screen.getByText(COPY.assistantOffline)));
    assert.equal(screen.queryByText(/leaf eaters/), null, "a reply appeared anyway");
    assert.equal(screen.queryByText("Working"), null, "left spinning");
    // The question they asked is still there — only the answer is withheld.
    assert.ok(screen.getByText("What do they eat?"));
  } finally {
    globalThis.setTimeout = real;
  }
});
