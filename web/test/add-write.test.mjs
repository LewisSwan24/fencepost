// Step 7 of the posting flow: write it up, post it, and the writing panel beside it.
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
// The page's own header names three more things that must not break, all about the writing
// panel (Possum Help, the Writer role): a candidate fun fact never enters the text by itself,
// only the button does that; the tidied story sits beside the original rather than over it,
// and replacing takes a press; neither verdict nor note appears in the panel. And from
// CLAUDE.md: Possum Help is a functional label with no avatar, and it has no write powers —
// it can suggest, never post.
//
// Offline, fixtures.submitEntry refuses any story containing BLOCKED_TRIGGER with
// reason_codes ["pii"]; everything else publishes into the shared fixture timelines, so the
// posting tests use fresh storyboard ids to keep out of other suites' way. writerHelp waits
// 650 ms in fixtures mode, which is why the panel tests wait with a longer timeout.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { screen, cleanup, waitFor, within } from "@testing-library/react";
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
const openPanel = () => screen.getByRole("button", { name: COPY.helperOpen });
const panel = () => screen.getByRole("dialog");
const slow = { timeout: 3000 };

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
  // An entry is a sighting in someone's own words (the Writer may not invent one), so there
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

test("opening Possum Help puts nothing into the post", async () => {
  // Header rule one: a candidate fun fact never enters the text by itself. The disclosure
  // says the same to the person: nothing goes in unless they put it there.
  const user = userEvent.setup({ document });
  await renderInFlow(WithSpy, { id: fresh(), seed: brushtail((d) => d.setStory("i saw one")) });

  await user.click(openPanel());
  await within(panel()).findByText("Fun facts you could use", {}, slow);

  assert.ok(within(panel()).getByText(COPY.helperDisclosure));
  assert.equal(seen.funFact, "", "a fun fact was filled in by opening the panel");
  assert.equal(seen.story, "i saw one", "the story was changed by opening the panel");
  assert.equal(funFact().value, "");
});

test("a candidate fun fact goes in only when its button is pressed, and appends", async () => {
  // The press is the only way in, and it adds to what the person already wrote rather than
  // replacing it.
  const user = userEvent.setup({ document });
  await renderInFlow(WithSpy, {
    id: fresh(),
    seed: brushtail((d) => { d.setStory("One on the fence."); d.setFunFact("Mine first."); }),
  });

  await user.click(openPanel());
  const adds = await within(panel()).findAllByRole("button", { name: COPY.addFact }, slow);
  await user.click(adds[0]);

  assert.match(seen.funFact, /^Mine first\. Brushtails are the possum most likely/);
  assert.equal(screen.queryByRole("dialog"), null, "the panel stayed open after adding");
});

test("the tidied story sits beside the original, and replacing takes a press", async () => {
  // Header rule two. Showing the tidied version is not the same as using it.
  const user = userEvent.setup({ document });
  await renderInFlow(WithSpy, { id: fresh(), seed: brushtail((d) => d.setStory("i saw one ,on the fence")) });

  await user.click(openPanel());
  await within(panel()).findByText("Tidied", {}, slow);

  assert.ok(within(panel()).getByText("As written"));
  assert.ok(within(panel()).getByText("i saw one ,on the fence"), "the original was not shown");
  assert.ok(within(panel()).getByText("I saw one,on the fence."), "the tidied version was not shown");
  assert.equal(seen.story, "i saw one ,on the fence", "the tidied story replaced the original unasked");

  await user.click(within(panel()).getByRole("button", { name: COPY.useTidied }));
  assert.equal(seen.story, "I saw one,on the fence.");
});

test("the panel shows no verdict and no note", async () => {
  // Header rule three. The Writer's output is candidates and a tidy-up; nothing in the panel
  // passes judgement on the person's writing (the Screener does not judge style either).
  const user = userEvent.setup({ document });
  await renderInFlow(WriteItUp, { id: fresh(), seed: brushtail((d) => d.setStory("i saw one")) });

  await user.click(openPanel());
  await within(panel()).findByText("Tidied", {}, slow);

  const text = panel().textContent;
  for (const word of [/verdict/i, /\bnote\b/i, /\bflagged\b/i, /\breject/i, /\bapprove/i]) {
    assert.doesNotMatch(text, word);
  }
});

test("Possum Help is a label with no avatar, and the panel cannot post", async () => {
  // CLAUDE.md: a functional label, not a persona, with no avatar; and no write powers — the
  // panel can suggest but nothing in it submits, so opening and using it navigates nowhere.
  const user = userEvent.setup({ document });
  await renderInFlow(WriteItUp, { id: fresh(), seed: brushtail((d) => d.setStory("i saw one")) });

  await user.click(openPanel());
  await within(panel()).findByText("Tidied", {}, slow);

  assert.equal(within(panel()).getByRole("heading", { level: 2 }).textContent.trim(), "Possum Help");
  assert.equal(panel().querySelector("img"), null, "the assistant was given a picture");
  assert.equal(within(panel()).queryByRole("button", { name: COPY.post }), null);

  await user.click(within(panel()).getByRole("button", { name: COPY.useTidied }));
  assert.deepEqual(navigated, [], "using a suggestion posted or navigated");
});

test("for a species Possum Help does not cover it says so and offers no facts", async () => {
  // Scope is brushtail and ringtail only; for other/unknown there are no candidates to add,
  // and the panel must not make some up.
  const user = userEvent.setup({ document });
  await renderInFlow(WriteItUp, {
    id: fresh(),
    seed: (d) => { d.setSpecies("other"); d.setStory("Something in the tree."); },
  });

  await user.click(openPanel());
  await within(panel()).findByText(COPY.helperEmpty, {}, slow);
  assert.equal(within(panel()).queryByRole("button", { name: COPY.addFact }), null);
});

test("editing the story after asking throws away the old tidy-up", async () => {
  // The tidied pane must be of the story as it now reads; a stale one would put words back
  // that the person has since changed.
  const user = userEvent.setup({ document });
  await renderInFlow(WriteItUp, { id: fresh(), seed: brushtail((d) => d.setStory("first go")) });

  await user.click(openPanel());
  await within(panel()).findByText("First go.", {}, slow);
  await user.keyboard("{Escape}");
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));

  await user.clear(story());
  await user.type(story(), "second go");
  await user.click(openPanel());
  await within(panel()).findByText("Second go.", {}, slow);
  assert.equal(within(panel()).queryByText("First go."), null, "the stale tidy-up came back");
});

test("Back returns to choosing the species", async () => {
  const id = fresh();
  const user = userEvent.setup({ document });
  await renderInFlow(WriteItUp, { id, seed: brushtail() });

  await user.click(screen.getByRole("button", { name: /back/i }));
  assert.deepEqual(navigated, [["push", `/b/${id}/add/species`]]);
});
