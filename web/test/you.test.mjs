// /you — your own account page, and pointedly not a profile.
//
//   node --import ./test/setup.mjs --test test/you.test.mjs
//
// The page's first comment carries the CLAUDE.md line against points, streaks, badges and
// leaderboards, and the reason it gives applies to the whole page: the moment it shows what
// somebody has done in a way another person could read, it is the thing that was ruled out.
// So the record here is yours alone and never comparative, and the access list is the one
// place a person sees what they are allowed to do where.
//
// The other rule is from the decision table: signing out is only for an account. A guest's
// handle is public, so a guest-facing Sign out would be a way for anybody to log a guest out.
// And Sign out has to leave the screen even though it now talks to the server.
//
// Identity offline: with no stored session whoAmI answers the fixtures guest (mel_k, not an
// account); signIn from lib/api is the fixture's own door to being an account, and it keeps
// user_id u_mel so the fixture data stays "mine".
//
// Unreachable offline, stated rather than forced: the "sign-in has ended" state (session_ended
// from dashboard or myRecord). The fixture calls never fail that way and lib/api's namespace
// import of fixtures cannot be replaced from a test, so the Sign in again button, the hidden
// access section and the dropped "Signed in" label under an ended session are not tested here.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import You from "../app/you/page.js";
import { COPY } from "../lib/copy.js";
import { signIn, signOut, whoAmI } from "../lib/api.js";
import { myRecord } from "../lib/fixtures.js";
import { renderScreen } from "./harness.mjs";
import { navigated, reset } from "./stubs/navigation.mjs";

// It is ready once the access list has been drawn. The h1 is the handle, which arrives with
// whoAmI, so the harness is not asked to wait for a heading that starts out blank.
async function open() {
  await renderScreen(You, { heading: false });
  await waitFor(() => screen.getByRole("link", { name: "The one in the jacaranda" }));
  await waitFor(() => screen.getByText(COPY.recordTitle));
}

beforeEach(async () => {
  reset();
  await signOut();
  window.localStorage.clear();
});
afterEach(() => cleanup());

test("a guest is told they are a guest, and how to become an account", async () => {
  // The page exists so a visitor can see the identity this browser made for them, and the
  // copy is accurate rather than reassuring about what an account does to it.
  const user = userEvent.setup({ document });
  await open();

  assert.ok(screen.getByText(COPY.guestTitle));
  assert.ok(screen.getByText(COPY.guestBody));
  await user.click(screen.getByRole("button", { name: COPY.signInTitle }));
  assert.deepEqual(navigated, [["push", "/sign-in"]]);
});

test("the screen is titled by the handle, as its one h1", async () => {
  // It had no h1 at all, so a screen reader moving by heading landed on "What you've kept"
  // with nothing saying which screen this was (#44). The handle is what the screen already
  // shows as its title; the sections under it stay h2.
  await open();

  const titles = screen.getAllByRole("heading", { level: 1 });
  assert.equal(titles.length, 1);
  assert.equal(titles[0].textContent, (await whoAmI()).handle);
  assert.ok(screen.getByRole("heading", { level: 2, name: COPY.recordTitle }));
});

test("a guest is never offered Sign out", async () => {
  // Decision table: sign-out is only for accounts with a password. A guest's handle is public,
  // so a Sign out for guests would let anyone sign a guest out.
  await open();
  assert.equal(screen.queryByRole("button", { name: COPY.signOut }), null);
});

test("an account is shown as signed in, without the guest explanation", async () => {
  // The two identities are different people; telling an account holder they are a guest
  // would be the page misdescribing who is acting.
  await signIn("rosa_p", "long enough");
  await open();

  assert.ok(screen.getByText("rosa_p"));
  assert.ok(screen.getByText("Signed in"));
  assert.equal(screen.queryByText(COPY.guestTitle), null);
  assert.equal(screen.queryByText(COPY.guestBody), null);
});

test("Sign out really signs out, and always leaves the screen", async () => {
  // signOut clears the local session before anything else and the page awaits it, then
  // leaves; a button that navigated but left the session behind would be a gesture, not a
  // sign-out (the 2026-09-18 decision on tokens and tokens_valid_from).
  const user = userEvent.setup({ document });
  await signIn("rosa_p", "long enough");
  await open();

  await user.click(screen.getByRole("button", { name: COPY.signOut }));
  await waitFor(() => assert.deepEqual(navigated, [["replace", "/"]]));
  assert.equal((await whoAmI()).account, false, "still an account after pressing Sign out");
});

test("your record is your own count, in your own words", async () => {
  // myRecord describes nobody but you, and this is the only screen it appears on.
  await open();
  const { entries } = myRecord();
  assert.ok(entries > 1, "the fixtures stopped holding more than one of mine");
  assert.ok(screen.getByText(String(entries)));
  assert.ok(screen.getByText("sightings"));
  assert.ok(screen.getByText(COPY.recordLatest, { exact: false }));
});

test("nothing on the page names or ranks another contributor", async () => {
  // "Never characterise contributors": no neighbour's handle, and nothing comparative.
  // Every other handle in the fixtures has entries on the boards listed here, so a
  // leaderboard or a "most active" line would bring at least one of them on screen.
  await open();
  const text = document.body.textContent;
  for (const other of ["dan_h", "aroha_t", "sione_f", "priya_r"]) {
    assert.ok(!text.includes(other), `another contributor was named: ${other}`);
  }
  assert.doesNotMatch(text, /\b(rank|leader|top contributor|most active|streak|badge|points)\b/i);
});

test("each storyboard you can reach says what you are allowed to do there", async () => {
  // The page comment: the level on each board is the only place a person can see what they
  // are actually allowed to do and where. A closed board is marked as past.
  await open();
  const rows = screen.getAllByRole("listitem");
  const byTitle = (title) => rows.find((row) => within(row).queryByRole("link", { name: title }));

  const jacaranda = byTitle("The one in the jacaranda");
  assert.equal(within(jacaranda).getByRole("link").getAttribute("href"), "/b/sb_jacaranda");
  assert.ok(within(jacaranda).getByText(COPY.levelLabel.reshare));
  assert.ok(!jacaranda.textContent.includes("past"), "an open board was marked past");

  const roof = byTitle("Roof thumper");
  assert.equal(within(roof).getByRole("link").getAttribute("href"), "/b/sb_roof");
  assert.ok(roof.textContent.includes(COPY.levelLabel.view), "the view grant was not named");
  assert.ok(roof.textContent.includes("· past"), "the archived board was not marked past");
});

test("the back button goes to all storyboards", async () => {
  // The only way off the page other than signing out or in.
  const user = userEvent.setup({ document });
  await open();
  await user.click(screen.getByRole("button", { name: "All storyboards" }));
  assert.deepEqual(navigated, [["push", "/"]]);
});
