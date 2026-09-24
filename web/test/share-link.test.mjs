// /s/[token] — where scanning a share code lands.
//
//   node --import ./test/setup.mjs --test test/share-link.test.mjs
//
// The page's header states the two outcomes a code can have. A good one goes into the
// storyboard it was made for, marked as arriving by link. A refusal from the server goes to
// /no-access and nowhere else, with nothing on the way out about the storyboard: expired and
// revoked must look alike, or a dead link becomes a probe for which storyboards exist.
//
// Offline, fixtures.redeemShareLink accepts any code beginning "fixture-" (for sb_jacaranda)
// and refuses everything else with a 404, which stands in for the server's refusal.
//
// Unreachable offline, stated rather than forced:
//   - A server that cannot be reached, or a sign-in that has ended (codes "unreachable" and
//     "session_ended"), which must stay on this page with the code still in the address bar
//     instead of calling a good code bad. The fixture never fails that way, and lib/api reads
//     the mode once at module scope, so the network path cannot be switched on per test.
//   - "Checking the code…" after 900 ms. The fixture answers within the same tick, so the
//     screen has always navigated before the timer could fire.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { screen, cleanup, waitFor } from "@testing-library/react";

import Redeem from "../app/s/[token]/page.js";
import { renderScreen } from "./harness.mjs";
import { navigated, reset } from "./stubs/navigation.mjs";

// The route's params are { token }, not { id }, so they go in as a prop that replaces the
// harness's default.
const scan = (token) =>
  renderScreen(Redeem, { heading: false, props: { params: Promise.resolve({ token }) } });

beforeEach(() => reset());
afterEach(() => cleanup());

test("a good code goes into the storyboard it was made for, marked as arriving by link", async () => {
  // Header: a successful redemption goes into the storyboard; ?via=link is how the board
  // knows to narrow itself to the level just granted.
  await scan("fixture-abc");
  await waitFor(() => assert.deepEqual(navigated, [["replace", "/b/sb_jacaranda?via=link"]]));
});

test("the code is read as the address carries it, percent-encoding and all", async () => {
  // "This address is what the code carries": a scanner may hand over an encoded path, and
  // redeeming the encoded form would refuse a good code.
  await scan("fixture%2Dabc");
  await waitFor(() => assert.deepEqual(navigated, [["replace", "/b/sb_jacaranda?via=link"]]));
});

test("a refused code goes to /no-access, and only there", async () => {
  // A refusal from the server says the code is no good; the one place for that is
  // /no-access, and it must not also try to open the storyboard.
  await scan("sl_dead_one");
  await waitFor(() => assert.deepEqual(navigated, [["replace", "/no-access"]]));
});

test("a refusal says nothing about the storyboard on its way out", async () => {
  // Expired and revoked must look alike: no title, no level, no error text from the server
  // is drawn here before leaving.
  await scan("sl_dead_one");
  await waitFor(() => assert.equal(navigated.length, 1));
  const text = document.body.textContent;
  for (const leak of ["jacaranda", "Roof thumper", "expired", "revoked", "doesn't work"]) {
    assert.ok(!text.includes(leak), `the refusal page showed: ${leak}`);
  }
  assert.equal(screen.queryByRole("heading"), null);
});
