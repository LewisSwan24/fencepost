// The park's Share form, mounted the way the web app mounts it.
//
//   node --import ./test/setup.mjs --test test/park-share-form.test.mjs
//
// Two things the 2026-11-10 audit found. The three choices arrived already made (a
// brushtail possum, early morning, the general park area), so a form sent without
// touching them claimed a sighting nobody described. And a missing answer was reported by
// the browser's own bubble, while the seven error slots under the fields stayed empty.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Node has a FormData of its own, so setup.mjs leaves it in place, and Node's cannot read
// a jsdom form. The park code builds its draft with `new FormData(form)`.
globalThis.FormData = window.FormData;

const { mount } = await import("../public/wildlife/shared/mobile.js");

let root, stop;
const settle = () => new Promise((r) => setTimeout(r, 30));

beforeEach(async () => {
  stop?.();
  localStorage.clear();
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
  location.hash = "#share";
  stop = await mount(root);
  await settle();
});

const form = () => root.querySelector("#observation-form");
const errorFor = (name) => root.querySelector(`[data-error="${name}"]`);

test("the share form starts with nothing chosen for the visitor", () => {
  for (const name of ["possibleSpecies", "approximateTime", "publicArea"]) {
    assert.equal(form().elements[name].value, "", `${name} arrives pre-filled`);
  }
});

test("a form sent empty says what is missing beside each field", async () => {
  assert.ok(form().noValidate, "the browser's own bubbles would answer first");
  form().requestSubmit();
  await settle();
  for (const name of ["possibleSpecies", "approximateTime", "publicArea", "behaviour", "description"]) {
    assert.notEqual(errorFor(name).textContent.trim(), "", `nothing said about ${name}`);
    assert.equal(form().elements[name].getAttribute("aria-invalid"), "true", name);
  }
  assert.equal(location.hash, "#share", "an incomplete form moved on to the preview");
  assert.equal(document.activeElement, form().elements.possibleSpecies, "focus is not on the first gap");
});

test("answering a field clears its error, and a complete form moves on", async () => {
  form().requestSubmit();
  await settle();
  const f = form();
  f.elements.possibleSpecies.value = "brushtail";
  f.elements.possibleSpecies.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(errorFor("possibleSpecies").textContent, "");
  assert.equal(f.elements.possibleSpecies.hasAttribute("aria-invalid"), false);
  assert.notEqual(errorFor("behaviour").textContent, "", "an unanswered field was cleared too");
  f.elements.approximateTime.value = f.elements.approximateTime.options[1].value;
  f.elements.publicArea.value = f.elements.publicArea.options[1].value;
  f.elements.behaviour.value = "Resting on a branch";
  f.elements.description.value = "It sat still for a few minutes.";
  f.elements.safeConsent.checked = true;
  f.requestSubmit();
  await settle();
  assert.equal(location.hash, "#preview");
});
