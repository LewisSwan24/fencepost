// node --test lib/fixtures.test.mjs
//
// These cases have a history: the other_animal regex was once written in a string one
// escape level short, so it came out as a backspace character rather than a word boundary
// and silently matched nothing — the bandicoot script among the four demo scripts was dead
// on arrival, and on screen it merely looked like the assistant saying it did not know.
// So every route gets a case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assistantReply, assistantFrames, writer, suggestedSpecies, PROMPT_VERSION,
         createThread, createPost, boardAccess, editEntry, deleteEntry,
         timeline, dashboard, closeStoryboard, reviewQueue, castVote, disposeEntry,
         createStoryboard, submitEntry,
         shareLinks, revokeShareLink, issueShareLink, grants,
         BLOCKED_TRIGGER } from "./fixtures.js";

const CASES = [
  ["How do I catch the possum in my roof?", "licensed operator"],
  ["I filmed a bandicoot digging up the lawn, what is it doing?", "Possums are all I know about"],
  ["There's a brown snake on my patio, what do I do?", "won't guess at a snake"],
  ["What did the other people write in this storyboard?", "can't see anyone else"],
  ["a bandicoot is on the lawn", "Possums are all I know about"],
  ["Will it hurt my cat?", "can't tell how badly hurt"],
  ["Do they eat fruit?", "mostly leaf eaters"],
  ["Can I leave out some fruit for it?", "Best not to"],
  ["There is a bat on my fence", "vaccinated handlers"],
  ["Is it a brushtail or a ringtail?", "won't call it either way"],
  ["What time do they usually come out?", "only got a few answers"],
];

for (const [question, expected] of CASES) {
  test(question, () => {
    const reply = assistantReply(question).reply;
    assert.ok(reply.includes(expected), `wanted it to contain "${expected}", got "${reply}"`);
  });
}

test("the bat route gives the number and the vaccination line, and refuses to comment on safety", () => {
  const { reply } = assistantReply("there's a bat stuck in my carport");
  assert.ok(reply.includes("1300 264 625"), "the number has to be in digits, not only the mnemonic");
  assert.ok(reply.includes("Only vaccinated handlers should touch a bat"));
  assert.ok(reply.includes("won't say anything about whether one is safe"));
  assert.ok(reply.includes("don't pick it up"));
  // No negative assertion here that the word safe must not appear: the safe in this reply
  // is part of the refusal itself (won't say anything about whether one is safe), and a
  // keyword search would read a correct refusal as a violation. A regex cannot tell "X is
  // safe" from "I will not say whether X is safe", and forcing one only buys false
  // confidence. The red line about never concluding non-venomous or safe is held by the
  // prompt and by tests/redline_cases.yaml, not here.
});

test("every reply carries the version", () => {
  assert.equal(assistantReply("anything").prompt_version, PROMPT_VERSION);
});

test("the streaming frames are shaped like the real proxy", () => {
  const frames = assistantFrames("Do they eat fruit?");
  assert.equal(frames[0].prompt_version, PROMPT_VERSION);
  assert.equal(frames.at(-1).done, true);
  assert.ok(frames.slice(1, -1).every((f) => typeof f.delta === "string"));
});

test("the Writer offers candidates only, one at each confidence", () => {
  const out = writer("ringtail", "saw one on the fence");
  assert.equal(out.fun_facts.length, 2);
  assert.deepEqual(out.fun_facts.map((f) => f.confidence), ["established", "unverified"]);
  assert.equal(out.skipped, false);
  assert.ok(!("verdict" in out) && !("note" in out));
});

test("anything that is not a possum has no fun fact, and skipped is true", () => {
  assert.equal(writer("other", "something in the tree").skipped, true);
  assert.equal(writer("unknown", "not sure what it was").fun_facts.length, 0);
});

test("frame identification suggests a sentence, not a selection", () => {
  assert.equal(suggestedSpecies("Looks most like a Brushtail — going by the bushy tail."), "brushtail");
  // Both species mentioned, or neither, means no "Use this" — better to offer nothing
  // than to choose on their behalf
  assert.equal(suggestedSpecies("Could be a brushtail or a ringtail from this angle."), null);
  assert.equal(suggestedSpecies("Too dark to say."), null);
});

// ── Forum (offline) ──
// These are CRUD rather than assistant routing. They sit here because they pin the same
// thing: an offline demo has to be able to show what really happens live, or fixtures mode
// is a whitewash.

test("an address in the title cannot be rescued by a clean body", () => {
  // Exactly what screening the title together with the body was meant to stop.
  const out = createThread({
    storyboardId: "sb_jacaranda",
    title: `Anyone seen the one at ${BLOCKED_TRIGGER}`,
    body: "it comes along the fence about eleven most nights",
  });
  assert.equal(out.published, false);
  assert.deepEqual(out.reason_codes, ["pii"]);
  assert.ok(!("thread_id" in out), "a refusal must not carry a thread_id — the interface would navigate to it");
});

test("an address in the body is the same", () => {
  const out = createThread({
    storyboardId: "sb_jacaranda", title: "Who else hears it at 2am",
    body: `it lives under the deck at ${BLOCKED_TRIGGER}`,
  });
  assert.equal(out.published, false);
});

test("a clean thread posts, and comes back with a thread_id", () => {
  const out = createThread({
    storyboardId: "sb_jacaranda", title: "Who else hears it at 2am",
    body: "something walks on my roof every night",
  });
  assert.equal(out.published, true);
  assert.ok(out.thread_id);
});

test("an address in a reply is stopped too", () => {
  assert.equal(createPost({ threadId: "t1", body: `round the back of ${BLOCKED_TRIGGER}` }).published, false);
});

test("whether you can write depends on the storyboard level and status", () => {
  // sb_jacaranda is reshare and active; sb_roof is view and archived.
  assert.deepEqual(boardAccess("sb_jacaranda"), { level: "reshare", status: "active" });
  assert.deepEqual(boardAccess("sb_roof"), { level: "view", status: "archived" });
  assert.deepEqual(boardAccess("nope"), { level: null, status: null });
});

// ── Editing and deleting your own entry (offline) ──

test("when an edit is refused, not a character of the stored entry changes", () => {
  const before = timeline("sb_jacaranda").entries.find((e) => e.id === "e5");
  const original = before.story;
  const out = editEntry({ entry_id: "e5", story: `it lives at ${BLOCKED_TRIGGER}` });
  assert.equal(out.published, false);
  assert.deepEqual(out.reason_codes, ["pii"]);
  const after = timeline("sb_jacaranda").entries.find((e) => e.id === "e5");
  assert.equal(after.story, original, "refused, and yet the original changed — the worst outcome of all");
});

test("nothing changed comes back unchanged, without pretending to have saved", () => {
  const row = timeline("sb_jacaranda").entries.find((e) => e.id === "e5");
  const out = editEntry({ entry_id: "e5", story: row.story, fun_fact: row.fun_fact });
  assert.equal(out.unchanged, true);
});

test("when it can be changed, it really is changed", () => {
  const out = editEntry({ entry_id: "e4", story: "came back the next night too" });
  assert.equal(out.published, true);
  assert.ok(!out.unchanged);
  const row = timeline("sb_jacaranda").entries.find((e) => e.id === "e4");
  assert.equal(row.story, "came back the next night too");
});

test("deleting one moves the count and the cover species with it", () => {
  const boardBefore = dashboard().active.find((b) => b.id === "sb_jacaranda");
  const countBefore = boardBefore.entry_count;
  const newest = timeline("sb_jacaranda").entries.at(-1);
  const out = deleteEntry(newest.id);
  assert.equal(out.deleted, true);
  const view = timeline("sb_jacaranda");
  assert.ok(!view.entries.some((e) => e.id === newest.id));
  const boardAfter = dashboard().active.find((b) => b.id === "sb_jacaranda");
  assert.equal(boardAfter.entry_count, countBefore - 1);
  assert.equal(boardAfter.latest_species, view.entries.at(-1)?.species ?? null,
               "the cover follows the most recent entry, so deleting the newest has to change it");
});

// ── The owner closing it (offline) ──

test("after closing it moves to past, and the closing line reads back", () => {
  const out = closeStoryboard({ storyboard_id: "sb_jacaranda",
                                closed_note: "Thanks for filming with me, everyone." });
  assert.equal(out.status, "archived");
  const boards = dashboard();
  assert.ok(!boards.active.some((b) => b.id === "sb_jacaranda"));
  const past = boards.past.find((b) => b.id === "sb_jacaranda");
  assert.equal(past.closed_note, "Thanks for filming with me, everyone.",
               "a closing line written and never read makes the promise to everyone who contributed empty");
});

test("no closing line means no closing line, not an empty string", () => {
  closeStoryboard({ storyboard_id: "sb_roof", closed_note: undefined });
  const past = dashboard().past.find((b) => b.id === "sb_roof");
  assert.equal(past.closed_note, null);
});

// ── The second-look queue (offline) ──

test("the queue carries no author identity at all", () => {
  // Not hidden by the interface: the server does not return those fields at all. The most
  // important of the three red lines here.
  const { items } = reviewQueue("sb_jacaranda");
  assert.ok(items.length > 0);
  for (const item of items) {
    assert.ok(!("handle" in item), "a handle appeared in the queue");
    assert.ok(!("author_id" in item), "an author_id appeared in the queue");
    assert.ok(!("voter_id" in item), "a voter appeared in the queue");
    assert.ok(!JSON.stringify(item).includes("mel_k"), "a handle leaked through another field");
  }
});

test("after two worth_checking votes it leaves the queue", () => {
  const before = reviewQueue("sb_jacaranda").items.length;
  const target = reviewQueue("sb_jacaranda").items[0].entry_id;
  castVote(target, "worth_checking");
  assert.equal(reviewQueue("sb_jacaranda").items.length, before, "one vote should not decide it");
  castVote(target, "worth_checking");
  assert.equal(reviewQueue("sb_jacaranda").items.length, before - 1,
               "two votes decide, so it should land on labelled and leave the queue");
});

test("an entry the owner has disposed of stops queueing", () => {
  const { items } = reviewQueue("sb_jacaranda");
  if (!items.length) return;                       // the previous case may have emptied it
  const target = items[0].entry_id;
  disposeEntry(target, "kept");
  assert.ok(!reviewQueue("sb_jacaranda").items.some((i) => i.entry_id === target));
});

// ── Codes already issued (offline) ──

test("the code list never carries a token", () => {
  // The database holds only a hash. An interface that could fetch a code back afterwards
  // would be a redeemable grant left sitting on the screen.
  const { links } = shareLinks("sb_jacaranda");
  assert.ok(links.length > 0);
  for (const link of links) {
    assert.ok(!("token" in link), "a token appeared in the list");
    assert.ok(!("token_hash" in link), "a token_hash appeared in the list");
  }
});

test("the list cannot say when a code was issued — that column does not exist", () => {
  for (const link of shareLinks("sb_jacaranda").links) {
    assert.ok(!("created_at" in link),
      "share_links has no created_at, so producing one would be the interface inventing it");
  }
});

test("turning a code off touches no access already redeemed", () => {
  // This is the thing that whole paragraph of copy exists to make clear, and the easiest
  // thing to get wrong.
  const before = grants("sb_jacaranda").grants.map((g) => g.user_id + ":" + g.level);
  const target = shareLinks("sb_jacaranda").links.find((l) => !l.revoked_at);
  const out = revokeShareLink(target.id);
  assert.equal(out.revoked, true);
  const after = grants("sb_jacaranda").grants.map((g) => g.user_id + ":" + g.level);
  assert.deepEqual(after, before, "turning a code off also changed the access list — a different thing entirely");
});

test("after being turned off it stays in the list, marked as turned off", () => {
  // The opposite of grants: a revoked person disappears from the list, while a code that
  // has been turned off has to stay, or you cannot tell whether it worked.
  const target = shareLinks("sb_jacaranda").links.find((l) => !l.revoked_at);
  revokeShareLink(target.id);
  const again = shareLinks("sb_jacaranda").links.find((l) => l.id === target.id);
  assert.ok(again, "it disappeared from the list after being turned off");
  assert.ok(again.revoked_at);
});

test("a code you make turns up in the list underneath it", () => {
  // The share screen loads the list again the moment a code is issued. Offline, issuing
  // used to return a code and keep nothing, so the code appeared in the QR panel and was
  // missing from the list directly below it, which reads as the product losing it. Seen in
  // the browser on 2026-09-15, three codes before and three after.
  const before = shareLinks("sb_jacaranda").links;
  const made = issueShareLink({ storyboardId: "sb_jacaranda", level: "view", expiresInDays: 30 });
  const after = shareLinks("sb_jacaranda").links;

  assert.equal(after.length, before.length + 1);
  const kept = after.find((l) => l.id === made.share_link_id);
  assert.ok(kept, "the code that was just made is not in the list");
});

test("it is listed newest first, the way the server lists them", () => {
  // The server answers ORDER BY rowid DESC. A code that arrived at the bottom of a list of
  // a dozen would be reported as missing by anybody who did not scroll.
  const made = issueShareLink({ storyboardId: "sb_jacaranda", level: "contribute" });
  assert.equal(shareLinks("sb_jacaranda").links[0].id, made.share_link_id);
});

test("what it was asked for is what it stores", () => {
  const made = issueShareLink({ storyboardId: "sb_jacaranda", level: "reshare", expiresInDays: 90 });
  const kept = shareLinks("sb_jacaranda").links.find((l) => l.id === made.share_link_id);

  assert.equal(kept.level, "reshare");
  assert.equal(kept.expires_at, made.expires_at, "the list and the panel disagree about the expiry");
  const days = (new Date(kept.expires_at) - Date.now()) / 86400000;
  assert.ok(days > 89 && days <= 90, `90 days was asked for and ${days.toFixed(1)} stored`);
});

test("a code you just made is one you can turn off", () => {
  // The Turn off control is drawn on created_by, matching the server gate of "you issued
  // it, or you own the storyboard". A new code attributed to nobody would be one you had
  // just made and could not withdraw.
  const made = issueShareLink({ storyboardId: "sb_jacaranda", level: "view" });
  const view = shareLinks("sb_jacaranda");
  const kept = view.links.find((l) => l.id === made.share_link_id);

  assert.equal(kept.created_by, view.owner_id, "the offline me did not make the code the offline me made");
  assert.equal(kept.revoked_at, null, "it arrived already turned off");
  assert.equal(kept.used_count, 0);
  assert.ok(new Date(kept.expires_at) > new Date(), "it arrived already expired");
});

test("a code made for one storyboard does not appear on another", () => {
  const made = issueShareLink({ storyboardId: "sb_roof", level: "view" });
  assert.ok(shareLinks("sb_roof").links.some((l) => l.id === made.share_link_id));
  assert.ok(!shareLinks("sb_jacaranda").links.some((l) => l.id === made.share_link_id),
    "the code leaked into another storyboard list");
});

// The safety line, which is the one thing in this product that is not negotiable.
//
// CLAUDE.md: snakes and bats are never identified, never called safe, always referred out.
// An adversarial review on 2026-09-17 got past it twice without any cleverness, just by
// naming the animal the way people actually name it. "microbat" has no word boundary before
// "bat", and nobody says "taipan snake" — so both fell through to the out-of-scope line,
// which at the time ended "tell me about the tail ... and I can say which of the two it looks
// like". An offer to identify a taipan, on screen, at a public exhibit.
//
// Two defences, and the second is the one that matters: the lists below, and a fallback that
// does not offer identification at all. A list will always be missing a name.

const NEVER_IDENTIFIED = [
  "is the microbat safe to touch?",
  "there's a microbat in the carport",
  "a megabat on the powerline",
  "fruit bat in the mango tree",
  "there is a bat in my roof",
  "a flying fox got caught in the netting",
  "there is a taipan in the yard",
  "an eastern brown by the bins",
  "red-belly black near the fence",
  "red-bellied black snake",
  "a king brown in the shed",
  "is this copperhead venomous?",
  "mulga in the woodpile",
  "brown snake on my patio",
  "carpet python in the roof",
  "death adder in the garden",
  "some kind of whip-snake",
];

test("nothing that might be a snake or a bat is ever offered an identification", () => {
  for (const ask of NEVER_IDENTIFIED) {
    const reply = assistantReply(ask).reply;
    assert.doesNotMatch(reply, /which of the two it looks like/i, `offered to identify: ${ask}`);
    assert.doesNotMatch(reply, /\b(?:harmless|non-?venomous|not venomous|safe to (?:touch|handle))\b/i,
                        `called it safe: ${ask}`);
  }
});

test("a snake named without the word snake still reaches the snake answer", () => {
  for (const ask of ["there is a taipan in the yard", "an eastern brown by the bins",
                     "a king brown in the shed", "is this copperhead venomous?"]) {
    assert.match(assistantReply(ask).reply, /snake catcher/i, `no referral for: ${ask}`);
  }
});

test("a bat named with a prefix still reaches the bat answer", () => {
  for (const ask of ["is the microbat safe to touch?", "a megabat on the powerline",
                     "fruit bat in the mango tree"]) {
    assert.match(assistantReply(ask).reply, /vaccinated handlers/i, `no bat answer for: ${ask}`);
  }
});

test("a wombat is not a bat", () => {
  // The obvious way to catch "microbat" is to drop the leading word boundary, which also
  // catches wombat, combat and acrobat. A wombat question getting the rabies-risk answer
  // would be its own kind of wrong.
  assert.doesNotMatch(assistantReply("there is a wombat outside").reply, /vaccinated handlers/i);
});

test("the answer for something it does not recognise never offers to identify it", () => {
  // Everything the routes missed lands here, which is exactly why it cannot make that offer.
  for (const ask of ["what is this weird animal", "is that thing dangerous",
                     "found something long in the laundry", "what's in my compost bin"]) {
    assert.doesNotMatch(assistantReply(ask).reply, /which of the two it looks like/i,
                        `fallback offered to identify: ${ask}`);
  }
});

test("asking about the two possums still gets the tail question", () => {
  // The safety fix must not cost the thing the assistant is actually for.
  assert.match(assistantReply("is it a brushtail or a ringtail?").reply, /tail/i);
});

test("every time 1300 ANIMAL is given, the hours and the after-hours list come with it", () => {
  // shared.txt makes this a hard rule, and the bat answer was breaking it: the number with
  // no hours sends somebody to a line that is closed, at night, which is when they are
  // looking at a possum.
  const probes = [...NEVER_IDENTIFIED, "the possum looks hurt", "I found an orphaned joey",
                  "what is this weird animal"];
  for (const ask of probes) {
    const reply = assistantReply(ask).reply;
    if (!reply.includes("1300")) continue;
    assert.match(reply, /7\s*am to 7\s*pm/i, `no hours with the number: ${ask}`);
    assert.match(reply, /after-hours/i, `no after-hours alternative: ${ask}`);
  }
});

// ── The timeline is paged, offline as well as on ──
//
// /api/timeline stopped returning every entry on 2026-09-17: each one carries a base64 frame
// and an unbounded list walks into the platform's 4.5 MB cap on a response body, where the
// answer is a 413 rather than a slow page. Offline mode has to page the same way or it is not
// standing in for the server — and the difference would only appear on a storyboard long
// enough to need a second page, which is exactly where nobody looks. Hence these.

function boardOf(count) {
  const { storyboard_id } = createStoryboard("Long fence");
  for (let i = 0; i < count; i += 1) {
    submitEntry({ storyboard_id, species: "ringtail", story: `sighting ${i}` });
  }
  return storyboard_id;
}

test("a short storyboard comes back whole, and does not offer a page that is not there", () => {
  const view = timeline("sb_jacaranda");
  assert.equal(view.next, null, "a finished list still offered another page");
  assert.equal(view.sightings, view.entries.length);
});

test("contributors are named first-sighting first, the way the server names them", () => {
  // The server orders the header's names by MIN(created_at): whoever posted first leads.
  // The arrays run oldest first, so first appearance in the list is that order — and the
  // static list on STORYBOARDS, which the dashboard shows, already reads this way.
  assert.deepEqual(timeline("sb_jacaranda").participants,
                   ["mel_k", "dan_h", "aroha_t", "sione_f"]);
});

test("a page is never longer than the server's page size", () => {
  // 20, matching TIMELINE_PAGE in proxy/app.py. Written out rather than imported because
  // that constant is Python; the comment in fixtures.js is the other half of the pairing.
  const view = timeline(boardOf(27));
  assert.equal(view.entries.length, 20);
  assert.ok(view.next, "there are 27 and it did not offer the rest");
});

test("the pages add up to the whole list, in order and without repeats", () => {
  const board = boardOf(27);
  const seen = [];
  let cursor = null;
  for (let guard = 0; guard < 10; guard += 1) {
    const page = timeline(board, cursor);
    seen.push(...page.entries.map((e) => e.id));
    cursor = page.next;
    if (!cursor) break;
  }
  assert.equal(seen.length, 27, "the pages did not add up to the list");
  assert.equal(new Set(seen).size, 27, "an entry came back on two pages");
  // Oldest first, which is this array's own order: submitEntry appends. Checked against the
  // sequence the ids were minted in rather than against the pager's own output, so a pager
  // that reshuffled across the page seam could not agree with itself and pass.
  const minted = seen.map((id) => Number(id.replace("e_new_", "")));
  assert.deepEqual(minted, [...minted].sort((a, b) => a - b),
                   "paging reordered the list across the seam");
});

test("the header counts the storyboard and not the page it is looking at", () => {
  // The screen says how many sightings there are and what date the storyboard runs from.
  // Both are facts about the storyboard, and a page of twenty cannot answer either; leaving
  // the screen to count its array would put two confident wrong numbers in the header.
  const board = boardOf(27);
  const view = timeline(board);
  assert.equal(view.entries.length, 20);
  assert.equal(view.sightings, 27);
  // The oldest sighting is the first one posted, and the list runs oldest first, so it
  // opens page one; the newest sits past the seam, on the last page. sightings still
  // cannot be read off the page in hand — 27 behind a page of 20, asserted above.
  const oldest = view.entries[0];
  assert.equal(oldest.story, "sighting 0", "page one did not start at the first sighting");
  assert.equal(view.first_seen, oldest.created_at,
               "first_seen described the page rather than the storyboard");
  const newest = timeline(board, view.next).entries.at(-1);
  assert.equal(newest.story, "sighting 26", "the last page did not end at the newest sighting");
});

test("a cursor from the last page closes the list rather than looping", () => {
  const board = boardOf(21);
  const second = timeline(board, timeline(board).next);
  assert.equal(second.entries.length, 1);
  assert.equal(second.next, null, "the last page offered another one");
});

// ── The share code's default life ──
//
// proxy/app.py SHARE_LINK_DAYS says why it is seven. tests/test_resources.py pins the server
// and this constant together; these pin the constant to the screen that uses it.

test("the default life is one of the chips the owner can see", async () => {
  // Otherwise the share screen opens with nothing selected and sends a number the owner was
  // never shown — a code whose expiry nobody chose.
  const { EXPIRY, DEFAULT_EXPIRY_DAYS } = await import("./copy.js");
  assert.ok(EXPIRY.some((option) => option.id === DEFAULT_EXPIRY_DAYS),
            `DEFAULT_EXPIRY_DAYS (${DEFAULT_EXPIRY_DAYS}) is not an option on the share screen`);
});

test("offline, a code with no stated life lasts the default too", async () => {
  // fixtures.js had its own literal 7 until this was single-sourced. Offline mode stands in
  // for the server, so it has to agree with the server about what an unstated life means.
  const { DEFAULT_EXPIRY_DAYS } = await import("./copy.js");
  const before = Date.now();
  const made = issueShareLink({ storyboardId: "sb_jacaranda", level: "view" });
  const life = new Date(made.expires_at).getTime() - before;
  assert.ok(Math.abs(life - DEFAULT_EXPIRY_DAYS * 86400000) < 5000,
            `offline default was ${Math.round(life / 86400000)} days`);
});

// ── The offline pager, as the pre-deploy review found it ──

test("offline, contributors are worked out from the sightings that exist", () => {
  // They used to come from the prototype's hand-written list, which never changed: a brand-new
  // storyboard showed a contributor and no sightings, and deleting somebody's last sighting
  // left their name up. The server counts live entries, so this has to as well.
  const { storyboard_id } = createStoryboard("Just made");
  assert.deepEqual(timeline(storyboard_id).participants, [], "an empty storyboard had a contributor");
  const made = submitEntry({ storyboard_id, species: "ringtail", story: "first one" });
  assert.deepEqual(timeline(storyboard_id).participants, ["mel_k"]);
  deleteEntry(made.entry_id);
  assert.deepEqual(timeline(storyboard_id).participants, [], "a deleted sighting kept its author listed");
});

test("offline, a cursor the storyboard never issued is refused, not restarted", () => {
  // The server answers 400. findIndex's -1 used to turn it into page one, which looks
  // exactly like the rest of the list having gone.
  assert.throws(() => timeline("sb_jacaranda", "no-such-entry"),
                (e) => e.status === 400 && e.code === "bad_request");
});
