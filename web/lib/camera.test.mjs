// What the camera screen says when there is no camera.
//
//   node --test lib/camera.test.mjs
//
// The viewfinder itself is not tested here for the same reason extractStills is not: node has
// no getUserMedia and no canvas. What is tested is the part that decides which of four
// sentences somebody reads, and — the reason this file exists at all — that those four
// sentences are really in COPY.
//
// lib/copy.test.mjs finds user-visible strings by scanning for COPY.<key>, which cannot see
// COPY[NOTICES[reason].title]. Without the last tests below, renaming a copy key would put
// the word "undefined" on the screen of somebody who has just been refused the camera, with
// the whole suite green.

import { test } from "node:test";
import assert from "node:assert/strict";
import { NOTICES, cameraSupported, reasonFor } from "./camera.js";
import { COPY } from "./copy.js";

test("saying no to the permission prompt reads as having said no", () => {
  assert.equal(reasonFor({ name: "NotAllowedError" }), "denied");
  // Some builds still throw the old prefixed spelling.
  assert.equal(reasonFor({ name: "PermissionDeniedError" }), "denied");
  // An insecure origin refuses the same way, and the advice is the same.
  assert.equal(reasonFor({ name: "SecurityError" }), "denied");
});

test("a device with no camera is not told to open its camera app", () => {
  assert.equal(reasonFor({ name: "NotFoundError" }), "missing");
  assert.equal(reasonFor({ name: "DevicesNotFoundError" }), "missing");
  // No device matched the constraints. The only constraint asked for is a preference, so
  // reaching this means the list was empty — the same sentence from where the user stands.
  assert.equal(reasonFor({ name: "OverconstrainedError" }), "missing");
  assert.equal(NOTICES.missing.exit, "library");
});

test("another app holding the lens is its own answer, not a shrug", () => {
  // The commonest failure on Android, and the only one anybody fixes in ten seconds. Folded
  // in with the rest it would read as "this device hasn't got a camera" on a phone with two.
  assert.equal(reasonFor({ name: "NotReadableError" }), "busy");
  assert.equal(reasonFor({ name: "TrackStartError" }), "busy");
  assert.equal(NOTICES.busy.exit, "camera");
});

test("anything unrecognised still gets a screen rather than a blank one", () => {
  assert.equal(reasonFor({ name: "SomethingNewInChrome" }), "other");
  assert.equal(reasonFor(new Error("no name at all")), "other");
  assert.equal(reasonFor(null), "other");
  assert.equal(reasonFor(undefined), "other");
});

test("no camera API means no camera offered", () => {
  // node has no navigator, which is the same answer this gives on http — getUserMedia is
  // secure-context only, so an origin without TLS has no mediaDevices to ask.
  assert.equal(cameraSupported(), false);
});

test("every sentence the camera screen can show is really in COPY", () => {
  const reasons = Object.keys(NOTICES);
  assert.ok(reasons.length >= 4, "all four reasons must have a screen");
  for (const reason of reasons) {
    const notice = NOTICES[reason];
    for (const slot of ["title", "body"]) {
      const key = notice[slot];
      assert.ok(key in COPY, `COPY has no key ${key} for the ${reason} screen`);
      assert.equal(typeof COPY[key], "string");
      assert.notEqual(COPY[key], "", `COPY.${key} is empty`);
    }
    assert.ok(["camera", "library"].includes(notice.exit),
              `the ${reason} screen offers an exit nothing handles: ${notice.exit}`);
  }
  // The two buttons those exits render.
  assert.ok(COPY.cameraFallback);
  assert.ok(COPY.cameraUseLibrary);
});

test("reasonFor only ever answers something NOTICES has a screen for", () => {
  const names = ["NotAllowedError", "PermissionDeniedError", "SecurityError", "NotFoundError",
                 "DevicesNotFoundError", "OverconstrainedError", "NotReadableError",
                 "TrackStartError", "AbortError", "TypeError", "", "whatever"];
  for (const name of names) {
    assert.ok(NOTICES[reasonFor({ name })], `no screen for what ${name} maps to`);
  }
});
