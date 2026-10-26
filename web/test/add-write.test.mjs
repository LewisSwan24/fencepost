// Step 7 of the manual posting flow: write it up and submit it.
//
//   node --import ./test/setup.mjs --test test/add-write.test.mjs
//
// The trap this screen shares with close and forum: a Screener refusal comes back **200 with
// published:false**, so `catch` never sees it. Treated as success it would push to the
// storyboard with `?posted=undefined`, and the author would be told nothing while their
// sighting silently failed to exist. The screen has to tell a refusal apart, send it to the
// blocked screen carrying only the reason codes, and leave the draft exactly as typed — the
// draft lives in the provider above the flow, and "Your writing is still there" on the next
// screen is only true if nothing here clears it.
//
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import WriteItUp from "../app/b/[id]/add/write/page.js";
import { useDraft } from "../app/b/[id]/add/DraftContext.js";
import { COPY } from "../lib/copy.js";
import { BLOCKED_TRIGGER } from "../lib/fixtures.js";
import { renderInFlow } from "./harness.mjs";
import { navigated, reset } from "./stubs/navigation.mjs";

let n = 0;
const fresh = () => "sb_write_test_" + (n += 1);

const story = () => screen.getByLabelText("What happened");
const funFact = () => screen.getByLabelText(/^Fun fact/);
const postButton = () => screen.getByRole("button", { name: COPY.post });

// A window onto the provider, so a test can check what the draft holds after the screen has
// done something, not just what the textareas happen to show.
let seen = null;
function Spy() {
  seen = useDraft();
  return null;
}
function WithSpy(props) {
  return (<><Spy /><WriteItUp {...props} /></>);
}

const brushtail = (extra) => (d) => { d.setSpecies("brushtail"); extra?.(d); };

beforeEach(() => { reset(); seen = null; });
afterEach(() => cleanup());

test("a refused post goes to the blocked screen with only the reason codes, never to the board", async () => {
  // The 200-with-published:false trap. A push to /b/<id>?posted=… here would read as success.
  const id = fresh();
  const user = userEvent.setup({ document });
  await renderInFlow(WriteItUp, { id, seed: brushtail() });

  await user.type(story(), `She came down the fence at ${BLOCKED_TRIGGER}.`);
  await user.click(postButton());

  await waitFor(() => assert.equal(navigated.length, 1));
  assert.deepEqual(navigated, [["push", `/b/${id}/add/blocked?codes=pii`]]);
  assert.ok(!navigated[0][1].includes("posted="), "a refusal was reported as posted");
});

test("a refusal leaves the draft exactly as the author typed it", async () => {
  // The blocked screen promises "Your writing is still there, exactly as you left it."
  // That sentence is only true if posting does not clear or trim the draft on the way out.
  const id = fresh();
  const user = userEvent.setup({ document });
  const typed = `  Up the jacaranda near ${BLOCKED_TRIGGER}, tail first.  `;
  await renderInFlow(WithSpy, { id, seed: brushtail((d) => d.setFunFact("They like figs.")) });

  await user.type(story(), typed);
  await user.click(postButton());
  await waitFor(() => assert.equal(navigated.length, 1));

  assert.equal(seen.story, typed, "the story was changed on refusal");
  assert.equal(seen.funFact, "They like figs.", "the fun fact was changed on refusal");
  assert.equal(seen.species, "brushtail", "the species was lost on refusal");
});

test("a published post goes back to the storyboard with the new entry marked", async () => {
  // The success half, so the refusal tests above are telling two outcomes apart and not
  // just observing that the screen always goes to the same place.
  const id = fresh();
  const user = userEvent.setup({ document });
  await renderInFlow(WriteItUp, { id, seed: brushtail() });

  await user.type(story(), "Ran along the fence at dusk.");
  await user.click(postButton());

  await waitFor(() => assert.equal(navigated.length, 1));
  const [verb, url] = navigated[0];
  assert.equal(verb, "push");
  assert.match(url, new RegExp(`^/b/${id}\\?posted=e_new_\\d+$`));
});

test("Post stays disabled until there is a story, and whitespace is not one", async () => {
  // An entry is a sighting in someone's own words, so there
  // is nothing to post without a story; the fun fact is optional.
  const user = userEvent.setup({ document });
  await renderInFlow(WriteItUp, { id: fresh(), seed: brushtail() });

  assert.equal(postButton().disabled, true);
  await user.type(funFact(), "A fact alone is not a sighting.");
  assert.equal(postButton().disabled, true, "posting with only a fun fact was allowed");
  await user.type(story(), "   ");
  assert.equal(postButton().disabled, true, "a blank story counted as a story");
  await user.type(story(), "Seen.");
  assert.equal(postButton().disabled, false);
});

test("arriving with no species chosen sends you back to choose one", async () => {
  // Deep-linking or refreshing empties the draft; posting then would carry species null and
  // the blocked screen would claim writing survived that never existed. The species is always
  // the person's own choice, so the flow goes back to it rather than filling one in.
  const id = fresh();
  await renderInFlow(WriteItUp, { id, heading: false });

  await waitFor(() => assert.deepEqual(navigated, [["replace", `/b/${id}/add/species`]]));
  assert.equal(screen.queryByRole("button", { name: COPY.post }), null,
               "the post button was on screen with no species");
});

test("the chosen species is shown and the screen does not change it", async () => {
  // Visual identification must never set the species; this screen only shows the choice.
  await renderInFlow(WithSpy, { id: fresh(), seed: (d) => d.setSpecies("ringtail") });
  assert.ok(screen.getByText("Ringtail"));
  assert.equal(seen.species, "ringtail");
});

test("Back returns to choosing the species", async () => {
  const id = fresh();
  const user = userEvent.setup({ document });
  await renderInFlow(WriteItUp, { id, seed: brushtail() });

  await user.click(screen.getByRole("button", { name: /back/i }));
  assert.deepEqual(navigated, [["push", `/b/${id}/add/species`]]);
});
