// The sign-in screen, rendered.
//
//   node --import ./test/setup.mjs --test test/sign-in.test.mjs
//
// First screen under the render harness, and chosen because it exercises every part of it at
// once: JSX, a CSS module, next/navigation, lib/copy, lib/api and components/ui. If this
// file runs, the other seventeen screens are reachable too.
//
// What it is actually for: this screen holds rules that live nowhere else and that nothing
// was checking. The submit button is disabled until the handle is three characters and the
// password eight — a rule written as one expression in the middle of a component, where a
// later edit can change 8 to 6 and no test will notice. The "there is no password reset"
// warning appears in one of the two modes and not the other. Swapping modes has to clear the
// error, or the previous mode's failure sits under the new mode's form.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SignInScreen from "../app/sign-in/page.js";
import { COPY } from "../lib/copy.js";
import { reset } from "./stubs/navigation.mjs";

beforeEach(() => reset());
afterEach(() => cleanup());

const submit = () => screen.getByRole("button", { name: COPY.signInTitle });

test("the fields are reachable by their labels", () => {
  // Not a formality. These inputs are labelled by a <label> wrapping them rather than by
  // htmlFor, and if that wrapping is ever broken into siblings the field keeps working with
  // a mouse and stops being announced at all.
  render(<SignInScreen />);
  assert.ok(screen.getByLabelText(COPY.handleLabel));
  assert.ok(screen.getByLabelText(COPY.passwordLabel));
});

test("you cannot submit an empty form", () => {
  render(<SignInScreen />);
  assert.equal(submit().disabled, true);
});

test("a short handle or a short password still cannot be submitted", async () => {
  const user = userEvent.setup({ document });
  render(<SignInScreen />);

  await user.type(screen.getByLabelText(COPY.handleLabel), "ab");
  await user.type(screen.getByLabelText(COPY.passwordLabel), "longenough");
  assert.equal(submit().disabled, true, "two characters was accepted as a handle");

  await user.clear(screen.getByLabelText(COPY.passwordLabel));
  await user.type(screen.getByLabelText(COPY.handleLabel), "c");
  await user.type(screen.getByLabelText(COPY.passwordLabel), "short");
  assert.equal(submit().disabled, true, "five characters was accepted as a password");
});

test("three characters and eight characters is enough", async () => {
  const user = userEvent.setup({ document });
  render(<SignInScreen />);

  await user.type(screen.getByLabelText(COPY.handleLabel), "abc");
  await user.type(screen.getByLabelText(COPY.passwordLabel), "12345678");
  assert.equal(submit().disabled, false);
});

test("only the register mode warns that there is no way back in", async () => {
  const user = userEvent.setup({ document });
  render(<SignInScreen />);

  assert.equal(screen.queryByText(COPY.noReset), null, "shown to somebody who already has an account");
  await user.click(screen.getByRole("button", { name: COPY.toRegister }));
  assert.ok(screen.getByText(COPY.noReset), "making an account without saying there is no reset");
});

test("the password field tells a password manager which mode it is in", async () => {
  // new-password offers to generate and save one; current-password offers what is stored.
  // Getting these the wrong way round is invisible on screen and wrong in the one place it
  // shows up.
  const user = userEvent.setup({ document });
  render(<SignInScreen />);

  assert.equal(screen.getByLabelText(COPY.passwordLabel).getAttribute("autocomplete"),
               "current-password");
  await user.click(screen.getByRole("button", { name: COPY.toRegister }));
  assert.equal(screen.getByLabelText(COPY.passwordLabel).getAttribute("autocomplete"),
               "new-password");
});
