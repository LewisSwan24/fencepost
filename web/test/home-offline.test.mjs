// My storyboards with the network gone, in hybrid mode.
//
//   node --import ./test/setup.mjs --test test/home-offline.test.mjs
//
// A failed "Create" used to set the page's error, which is drawn at the top of the list —
// behind the sheet's scrim, while the sheet itself sat there unchanged. The person tapping
// Create is looking at the sheet, so that is where it has to be said.
//
// setup.mjs sets fixtures mode and lib/api reads the mode once at module scope, so this file
// switches to hybrid before importing anything that reaches lib/api, the same way
// name-gate.test.mjs does. Every request is refused, which is the venue Wi-Fi giving out.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { act, render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

process.env.NEXT_PUBLIC_FENCEPOST_MODE = "hybrid";
globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
window.fetch = globalThis.fetch;
window.localStorage.setItem("fencepost.handle", "qa_offline-12345678");

const { default: Home } = await import("../app/page.js");

afterEach(() => cleanup());

test("a Create that cannot reach the server says so in the sheet, and keeps the title", async () => {
  await act(async () => { render(<Home />); });
  const user = userEvent.setup({ document });

  await user.click(screen.getByRole("button", { name: "New storyboard" }));
  const sheet = screen.getByRole("dialog");
  await user.type(within(sheet).getByLabelText("Title"), "Fence at number 16{Enter}");

  const said = await waitFor(() => within(sheet).getByRole("alert"));
  assert.ok(said.textContent.length > 0, "the sheet's alert is empty");
  assert.equal(within(sheet).getByLabelText("Title").value, "Fence at number 16");
  assert.ok(within(sheet).getByRole("button", { name: "Create" }), "Create did not come back");
});
