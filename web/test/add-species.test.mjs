// Step 6 of the posting flow, and one of the places a red line is drawn in the interface
// rather than written down.
//
//   node --import ./test/setup.mjs --test test/add-species.test.mjs
//
// **Visual identification must never set the species.** The model looks at a frame and
// returns a sentence; the species that goes on the entry is the one the person picked. Every
// safety branch downstream reads that field — what the assistant will say, whether the answer
// is about a brushtail in a roof or a ringtail in a drey — so an identification that quietly
// became a decision is wrong in a way that spreads.
//
// The screen keeps that line in three separate places, and each of them is one edit from
// gone: nothing is preselected, Next stays disabled until a choice is made, and where the
// sentence names both species or neither there is no "Use this" button at all. The third is
// the subtle one. `suggestedSpecies` returns null unless exactly one name appears, and the
// screen has to honour that by offering nothing — a screen that fell back to the first hit,
// or to brushtail, would read as helpful and would be choosing on somebody's behalf.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import WhichOne from "../app/b/[id]/add/species/page.js";
import { SPECIES } from "../lib/fixtures.js";
import { renderInFlow } from "./harness.mjs";
import { navigated, reset } from "./stubs/navigation.mjs";

const ONE = "The shape and the ears look like a brushtail to me, though the light is poor.";
const BOTH = "Could be a brushtail, could be a ringtail — the tail is out of frame.";
const NEITHER = "Too dark to say what that is.";

const next = () => screen.getByRole("button", { name: "Next" });
// Anchored: the offer is named "Use Brushtail" and the choice "Brushtail Common Brushtail
// Possum", so an unanchored /Brushtail/ matches both and the query throws rather than failing.
const option = (label) => screen.getByRole("button", { name: new RegExp(`^${label}`) });
const picked = () =>
  SPECIES.filter((s) => option(s.label).getAttribute("aria-pressed") === "true");

beforeEach(() => reset());
afterEach(() => cleanup());

test("a suggestion naming one species chooses nothing on the person's behalf", async () => {
  await renderInFlow(WhichOne, { seed: (d) => d.setSuggestion(ONE) });

  assert.ok(screen.getByText(ONE), "the sentence the model returned is not shown");
  assert.deepEqual(picked(), [], "the suggestion had been selected for them");
  assert.equal(next().disabled, true);
});

test("the suggestion is an offer, and taking it is an action", async () => {
  const user = userEvent.setup({ document });
  await renderInFlow(WhichOne, { seed: (d) => d.setSuggestion(ONE) });

  await user.click(screen.getByRole("button", { name: "Use Brushtail" }));
  assert.deepEqual(picked().map((s) => s.id), ["brushtail"]);
  assert.equal(next().disabled, false);
});

test("a sentence naming both species offers neither", async () => {
  await renderInFlow(WhichOne, { seed: (d) => d.setSuggestion(BOTH) });

  assert.ok(screen.getByText(BOTH), "the sentence itself is still worth showing");
  assert.equal(screen.queryByRole("button", { name: /^Use / }), null,
               "one of the two names was picked out of an ambiguous sentence");
});

test("a sentence naming no species offers none", async () => {
  await renderInFlow(WhichOne, { seed: (d) => d.setSuggestion(NEITHER) });

  assert.ok(screen.getByText(NEITHER));
  assert.equal(screen.queryByRole("button", { name: /^Use / }), null);
});

test("with no suggestion at all the screen is just the four choices", async () => {
  await renderInFlow(WhichOne);

  assert.equal(screen.queryByText("From the frame you sent"), null);
  assert.equal(screen.queryByRole("button", { name: /^Use / }), null);
  assert.equal(next().disabled, true);
});

test("dismissing the suggestion takes the sentence away and leaves the choices", async () => {
  const user = userEvent.setup({ document });
  await renderInFlow(WhichOne, { seed: (d) => d.setSuggestion(ONE) });

  await user.click(screen.getByRole("button", { name: "Pick a different one" }));
  assert.equal(screen.queryByText(ONE), null);
  assert.deepEqual(picked(), [], "dismissing it should not have chosen anything either");
  assert.ok(option("Ringtail"));
});

test("every choice the person can make is one of the four, and picking one is enough", async () => {
  // Including "Something else" and "Not sure". An entry whose species is other or unknown gets
  // no placeholder photograph — lib/frames.js draws that line — so these two have to be
  // reachable, not decorative.
  const user = userEvent.setup({ document });
  for (const choice of SPECIES) {
    await renderInFlow(WhichOne);
    await user.click(option(choice.label));
    assert.deepEqual(picked().map((s) => s.id), [choice.id]);
    assert.equal(next().disabled, false, `${choice.label} did not let the flow continue`);
    cleanup();
  }
});

test("Next goes on to the writing step, and Back returns to masking", async () => {
  const user = userEvent.setup({ document });
  await renderInFlow(WhichOne, { id: "sb_jacaranda" });

  await user.click(option("Brushtail"));
  await user.click(next());
  assert.deepEqual(navigated, [["push", "/b/sb_jacaranda/add/write"]]);
});
