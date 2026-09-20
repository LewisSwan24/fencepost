// 12 · Share. The screen where a permission is handed to somebody in person.
//
//   node --import ./test/setup.mjs --test test/share.test.mjs
//
// The hazard here is not a crash, it is a square that means something other than what the
// screen says it means. The code on screen carries a level and a lifetime, both chosen just
// above it, and both changeable after the code exists. A code that outlives the level it was
// made for is an owner who thinks they granted "can view" holding up a "can reshare".
//
// The other thing this screen has to keep apart is codes and people. Turning a code off stops
// whoever has not used it yet; it does nothing to anybody who already did. Revoking a person
// does not turn off a code they issued. They are two lists for that reason and the tests
// treat them as two.
//
// Not covered here: the branch that sends somebody without reshare back to the storyboard.
// It needs grants() to reject with cannot_share, and offline grants() always resolves, so
// reaching it would mean stubbing lib/api — a bigger change than the test is worth. The
// server refuses that caller regardless; what is untested is only the redirect that saves
// them from a button certain to be refused.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Share from "../app/b/[id]/share/page.js";
import { COPY, DEFAULT_EXPIRY_DAYS, EXPIRY } from "../lib/copy.js";
import { monthDay } from "../lib/format.js";
import { renderScreen } from "./harness.mjs";
import { reset } from "./stubs/navigation.mjs";

// An address nothing else in the file touches. Offline, an unknown storyboard answers with
// no codes, nobody but the owner, and me as the owner — which is exactly the blank slate a
// test that issues a code wants, and it keeps the mutating tests out of each other's way.
let n = 0;
const fresh = () => "sb_share_test_" + (n += 1);

// A code is a div, not anything with a role, so the rows are counted by the class the CSS
// module hands back. Under the loader that is the key itself, so `.code` is exactly the row
// and not codeText, codeMeta or codeLevel.
const codeRows = () => [...document.querySelectorAll(".code")];
const people = () => [...document.querySelectorAll(".person")];
const rowFor = (handle) => people().find((p) => p.textContent.includes("@" + handle));

// sl_2's expiry, the one fixed date in the code list and the only one already in the past.
const SL2_EXPIRY = "2026-09-15T09:00:00+10:00";

const qr = () => screen.queryByRole("img");
const makeCode = () => screen.getByRole("button", { name: /^Make an?o?t?h?e?r? ?code$/ });
const level = (label) => screen.getByRole("button", { name: new RegExp("^" + label) });
const chip = (label) => screen.getByRole("button", { name: label });

// grants() is what the footer button waits on, so the people block arriving is the signal
// that this screen is done loading.
const loaded = () => waitFor(() => assert.ok(people().length > 0 || codeRows().length > 0
                                             || screen.queryByText(COPY.noCodesYet)));

async function open(id) {
  await renderScreen(Share, { id });
  await loaded();
  return userEvent.setup();
}

beforeEach(() => reset());
afterEach(() => cleanup());

test("the screen opens on the lifetime the server would have picked anyway", async () => {
  await open("sb_jacaranda");

  // tests/test_resources.py pins DEFAULT_EXPIRY_DAYS to SHARE_LINK_DAYS across the two
  // languages. What it cannot see is whether the screen actually opens on it: a chip that
  // is merely one of four, or none of them, sends a number the owner never chose.
  const on = [...document.querySelectorAll(".chip")].filter((c) => c.className.includes("chipOn"));
  assert.equal(on.length, 1, "exactly one lifetime is selected on arrival");
  assert.equal(on[0].textContent,
               EXPIRY.find((e) => e.id === DEFAULT_EXPIRY_DAYS).label);
});

test("nothing scannable is on screen until there is something to scan", async () => {
  await open("sb_jacaranda");

  // The placeholder is aria-hidden, the real code is a role=img with a label. So "is there
  // a code" is answerable without reaching for a class name, and the answer is also the
  // accessibility behaviour we want: a decorative square is not announced, a real one is.
  assert.equal(qr(), null, "a scannable square before a code exists points somewhere invented");
  assert.ok(screen.getByText(COPY.qrNote));
  assert.equal(screen.queryByText(COPY.qrLive), null);
});

test("making a code puts a real one up, pointing at the token just issued", async () => {
  const user = await open(fresh());
  await user.click(makeCode());

  const code = await screen.findByRole("img");
  assert.match(code.getAttribute("aria-label"), /QR code/);
  assert.ok(screen.getByText(COPY.qrLive));
  assert.equal(screen.queryByText(COPY.qrNote), null);

  // The address under it is the one a scan lands on, and it carries the token rather than
  // the storyboard id — the whole point of the screen is that the code is the credential.
  assert.ok(screen.getByText(/^http:\/\/localhost:3000\/s\/fixture-/),
            "the address on screen is the redeem address for this token");
});

test("changing what the code allows takes the old code down", async () => {
  const user = await open(fresh());
  await user.click(makeCode());
  await screen.findByRole("img");

  await user.click(level("Can view"));

  // A square that outlives the level it was made for is the failure this screen exists to
  // avoid: the owner reads "Can view" off the list and holds up a code that says reshare.
  assert.equal(qr(), null, "the code made under the old level is still on screen");
  assert.ok(screen.getByText(COPY.qrNote));
});

test("and so does changing how long it lasts", async () => {
  const user = await open(fresh());
  await user.click(makeCode());
  await screen.findByRole("img");

  await user.click(chip("30 days"));

  assert.equal(qr(), null, "the code made under the old lifetime is still on screen");
});

test("the three ways a code can stop working are said separately", async () => {
  await open("sb_jacaranda");

  // Not collapsed into "invalid". An owner who sees "Expired" knows to make another; one
  // who sees "Turned off" knows somebody turned it off; "Used up" is neither.
  const said = codeRows().map((r) => r.textContent);
  assert.ok(said.some((t) => t.includes(COPY.codeState.expired)));
  assert.ok(said.some((t) => t.includes(COPY.codeState.revoked)));

  // And the level is still legible on a dead code, so the list reads as a history rather
  // than as a row of failures.
  assert.ok(said.every((t) => Object.values(COPY.levelLabel).some((l) => t.includes(l))));
});

test("a code whose date has gone says when it was good until, not Expires expired", async () => {
  await open("sb_jacaranda");

  // until() is the forward-looking formatter and answers the bare word "expired" for a date
  // in the past, so bolting the label on in front of it read "Expires expired" — redundant
  // next to the badge and not a sentence either way.
  const dead = codeRows().find((r) => r.textContent.includes(COPY.codeState.expired));
  assert.ok(dead, "the demo list has no expired code left to read");
  assert.doesNotMatch(dead.textContent, /Expires expired/);
  assert.ok(dead.textContent.includes(COPY.codeUntil + " " + monthDay(SL2_EXPIRY)),
            "an expired code does not say the date it was good until");

  // And the two cases either side of it are untouched: a code still working counts down,
  // and a code with no expiry at all says so rather than being given one.
  const live = codeRows().find((r) => r.querySelector("button"));
  assert.ok(live.textContent.includes(COPY.codeExpires + " in "),
            "a live code stopped counting down");
  assert.equal(codeRows().filter((r) => r.textContent.includes(COPY.codeNoExpiry)).length, 1,
               "the code with no expiry was given one, or given two");
});

test("a date that has gone never stands without the word that says why", async () => {
  await open("sb_jacaranda");

  // What lets the line drop the verb: a past expiry always carries a badge, because
  // stateOf answers Turned off or Expired for every one of them. If that ever stops being
  // true, "Until 15 Sep" is on screen with nothing saying the code is finished.
  for (const row of codeRows()) {
    if (!row.textContent.includes(COPY.codeUntil + " ")) continue;
    assert.ok(Object.values(COPY.codeState).some((s) => row.textContent.includes(s)),
              "a date in the past with nothing beside it to say the code has stopped");
  }
});

test("a code that has stopped working offers no way to turn it off", async () => {
  await open("sb_jacaranda");

  for (const row of codeRows()) {
    const dead = Object.values(COPY.codeState).some((s) => row.textContent.includes(s));
    const off = [...row.querySelectorAll("button")].some((b) => b.textContent === COPY.turnOff);
    assert.equal(off, !dead, "a dead code was offered a Turn off button, or a live one was not");
  }
});

test("an address with no codes says so, rather than leaving a gap", async () => {
  await open(fresh());

  assert.ok(screen.getByText(COPY.noCodesYet));
  assert.equal(codeRows().length, 0);
});

test("a code that has just been made is in the list underneath it", async () => {
  const user = await open(fresh());
  assert.equal(codeRows().length, 0);

  await user.click(makeCode());

  // Offline this once issued a code and did not keep it, so the code appeared above a list
  // that did not have it — which reads as the product losing it.
  await waitFor(() => assert.equal(codeRows().length, 1));
  assert.ok(codeRows()[0].textContent.includes(COPY.codeMadeByYou));
});

test("a live code can be turned off, and then says so", async () => {
  const user = await open(fresh());
  await user.click(makeCode());
  await waitFor(() => assert.equal(codeRows().length, 1));

  const off = await screen.findByRole("button", { name: COPY.turnOff });
  await user.click(off);

  await waitFor(() => assert.ok(codeRows()[0].textContent.includes(COPY.codeState.revoked)));
  assert.equal(screen.queryByRole("button", { name: COPY.turnOff }), null,
               "a code already turned off still offers to be turned off");
});

test("the owner is not offered a way to revoke themselves", async () => {
  await open("sb_jacaranda");

  // Offline I am mel_k and mel_k owns the fixtures, so this screen is the owner's view.
  const mine = rowFor("mel_k");
  assert.ok(mine, "the owner is missing from the list of who has access");
  assert.equal(mine.querySelector("button"), null);

  for (const row of people()) {
    if (row === mine) continue;
    assert.ok([...row.querySelectorAll("button")].some((b) => b.textContent === COPY.revoke),
              "somebody other than the owner was not revocable");
  }
});

test("turning a code off leaves alone the people who already used it", async () => {
  const user = await open("sb_jacaranda");
  const before = people().map((p) => p.textContent);
  const turnedOff = () =>
    codeRows().filter((r) => r.textContent.includes(COPY.codeState.revoked)).length;
  const was = turnedOff();

  // The demo's own live code, not one made here, because that is the state an owner
  // actually opens this screen in.
  const off = screen.getAllByRole("button", { name: COPY.turnOff });
  assert.equal(off.length, 1, "the demo list is meant to hold exactly one code that works");
  await user.click(off[0]);
  await waitFor(() => assert.equal(turnedOff(), was + 1));

  // The copy promises this in so many words, and the two lists are separate because of it.
  assert.deepEqual(people().map((p) => p.textContent), before);
  assert.ok(screen.getByText(COPY.codesNote));
});

test("revoking somebody takes them out, and does not touch the codes", async () => {
  const user = await open("sb_jacaranda");
  const before = people().length;
  const codes = codeRows().length;

  const target = rowFor("priya_r");
  assert.ok(target, "the person this test revokes is not in the fixtures");
  await user.click([...target.querySelectorAll("button")]
    .find((b) => b.textContent === COPY.revoke));

  await waitFor(() => assert.equal(people().length, before - 1));
  assert.equal(rowFor("priya_r"), undefined);
  assert.equal(codeRows().length, codes, "revoking a person turned off a code as well");
});
