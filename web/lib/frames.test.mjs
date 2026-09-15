// The placeholder photographs, and the two promises attached to them.
//
//   node --test lib/frames.test.mjs
//
// Promise one is a red line from CLAUDE.md: visual identification never sets the species.
// frames.js is where that line is actually drawn in the interface — an entry whose species
// is "other" or "unknown" gets no picture, because putting a possum beside it would assert
// on the filmer's behalf what they saw. A helpful-looking fallback here would break it
// silently, with a plausible image on screen and nothing to notice.
//
// Promise two is a licence condition, not a courtesy. These are somebody else's photographs
// under CC BY-SA 4.0, and /credits carries the attribution that permits using them. The
// page maps over this array, so it cannot miss an image; what it can do is go stale in the
// prose around it, and carry a blanket count and licence that the next image quietly makes
// false.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FRAMES, frameFor, frameForSpecies } from "./frames.js";

const WEB = dirname(dirname(fileURLToPath(import.meta.url)));
const SPECIES_WITH_PICTURES = ["brushtail", "ringtail"];

// uuid4().hex, which is what proxy/db.py new_id() produces and so what a real entry id
// looks like. Generated here from a fixed counter rather than at random, so a failure is
// the same failure the next time it runs.
function ids(count) {
  const out = [];
  for (let n = 0; n < count; n += 1) out.push((n * 2654435761).toString(16).padStart(32, "0"));
  return out;
}

test("visual identification never sets the species", () => {
  // The red line. "other" and "unknown" are both real choices on the species screen, and
  // neither of them may come back with a possum attached.
  for (const species of ["other", "unknown", "", null, undefined, "snake", "bat"]) {
    assert.equal(frameForSpecies(species, "any-seed"), null,
      "species " + String(species) + " was given a picture");
  }
});

test("an entry that does not exist yet has no picture", () => {
  assert.equal(frameFor(null), null);
  assert.equal(frameFor(undefined), null);
});

test("the picture is always of the species the entry names", () => {
  // A brushtail photograph beside a story about a ringtail is a small lie the interface
  // tells on the author's behalf, and nothing downstream would catch it.
  for (const species of SPECIES_WITH_PICTURES) {
    for (const id of ids(40)) {
      assert.equal(frameFor({ species, id }).species, species);
    }
  }
});

test("only the two species this product covers have pictures at all", () => {
  // Scope is a decision with reasons behind it (CLAUDE.md), not an accident of what was
  // easy to find on Wikimedia. A third species appearing here would widen it by the back
  // door, without any of the safety work that widening actually needs.
  for (const frame of FRAMES) {
    assert.ok(SPECIES_WITH_PICTURES.includes(frame.species),
      frame.slug + " is a " + frame.species);
  }
});

test("the same entry gets the same picture every time", () => {
  // Why the index is derived from the id rather than chosen at random: a refresh that
  // changes the photograph reads as a broken page, not as a stand-in.
  for (const id of ids(20)) {
    const first = frameFor({ species: "ringtail", id });
    assert.equal(frameFor({ species: "ringtail", id }).slug, first.slug);
    assert.equal(frameForSpecies("ringtail", id).slug, first.slug);
  }
});

test("every picture is actually reachable, in both species", () => {
  // A hash that collapsed would leave some of them permanently unused: no error, no visible
  // fault, just an unexplained sameness down the timeline. This used to check ringtail only,
  // which was the species that happened to have more than one picture at the time — so it
  // would not have noticed the same fault in the other half of the set.
  for (const species of SPECIES_WITH_PICTURES) {
    const seen = new Set(ids(200).map((id) => frameFor({ species, id }).slug));
    for (const frame of FRAMES.filter((f) => f.species === species)) {
      assert.ok(seen.has(frame.slug), frame.slug + " is never picked for any entry id");
    }
  }
});

test("no species is left with a single picture", () => {
  // Not a style preference. One picture for a species means every sighting of it down a
  // timeline carries the same photograph, which reads as a broken page rather than as a
  // stand-in — and nothing else here would fail if that happened.
  for (const species of SPECIES_WITH_PICTURES) {
    const count = FRAMES.filter((f) => f.species === species).length;
    assert.ok(count > 1, "only " + count + " picture for " + species);
  }
});

test("every picture named here is a file that is really there", () => {
  // A renamed file is a broken image in the interface and a 404 in the network log, which
  // is the sort of thing that gets noticed during a demonstration rather than before one.
  for (const frame of FRAMES) {
    const path = join(WEB, "public", frame.file.replace(/^[/]/, ""));
    assert.ok(existsSync(path), frame.file + " is listed but not in public/frames");
  }
});

test("every picture carries what the licence requires", () => {
  // CC BY-SA 4.0 asks for the author, the licence, and a link to it. An empty field renders
  // as a blank line on /credits rather than as an error, so the page would look finished
  // and still not be attribution.
  for (const frame of FRAMES) {
    for (const field of ["author", "where", "licence", "licenceUrl", "source", "alt", "file"]) {
      const value = frame[field];
      assert.ok(typeof value === "string" && value.trim(),
        frame.slug + " has no " + field);
    }
    assert.equal(frame.licence, "CC BY-SA 4.0",
      frame.slug + " is under a different licence, which /credits states blanket");
    assert.match(frame.source, /^https:[/][/]commons[.]wikimedia[.]org[/]/);
  }
});

test("the credits page prose still matches how many pictures there are", () => {
  // The page maps over FRAMES, so it always lists every image. The sentences around that
  // list count them in words, and those cannot update themselves. If this fails, the fix
  // is in the prose on app/credits/page.js, not here.
  const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  const page = readFileSync(join(WEB, "app", "credits", "page.js"), "utf8");
  const total = words[FRAMES.length];
  const daylight = words[FRAMES.filter((f) => !f.night).length];

  assert.ok(total && daylight, "more pictures than this test can spell");
  assert.match(page, new RegExp("All " + total + " are from"),
    "there are now " + FRAMES.length + " pictures and the page does not say so");
  assert.match(page, new RegExp(daylight + " were taken in daylight", "i"),
    FRAMES.filter((f) => !f.night).length + " are daylight shots and the page does not say so");
});
