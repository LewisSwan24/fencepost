// ui.js: the shared pieces — BackButton, Steps, Frame, Spinner, and the Sheet dialog.
//
//   node --import ./test/setup.mjs --test test/ui.test.mjs
//
// Most of the weight is on Sheet, because its comments make accessibility promises that no
// screen shows when they break:
//
//   focus goes to the panel, not the first field — on a phone, auto-focusing a textarea
//   throws the keyboard up over half the screen;
//
//   on close, focus goes back to whatever opened it rather than being dropped on <body>;
//
//   Escape closes, and the key stops there, so a Sheet over the camera or over another
//   Escape listener does not close two things at once;
//
//   Tab is trapped inside, because aria-modal="true" tells a screen reader everything
//   outside does not exist, and without the trap that statement is false;
//
//   a click on the scrim closes, a click inside the panel does not.
//
// jsdom reports offsetParent as null for every element, which the trap reads as "not
// visible" and so finds nothing to trap. The Tab tests put a getter on HTMLElement for their
// own duration and take it off again.
//
// Steps is the five-step progress bar of the posting flow ("writing the entry is step
// five"); BackButton has to be nameable by a screen reader even though it is only an arrow.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { useState } from "react";
import { act, render, cleanup, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BackButton, Steps, Frame, Spinner, Sheet } from "../components/ui.js";

afterEach(() => cleanup());

async function draw(tree) {
  let view;
  await act(async () => { view = render(tree); });
  return view;
}

// A page with a button that opens a Sheet, which is how every caller uses it.
function Opener({ onClose = () => {} }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Start a thread</button>
      {open ? (
        <Sheet labelledBy="sheet-title" onClose={() => { onClose(); setOpen(false); }}>
          <h2 id="sheet-title">New thread</h2>
          <input aria-label="Title" />
          <textarea aria-label="Your message" />
          <button type="button">Post</button>
        </Sheet>
      ) : null}
    </div>
  );
}

function withVisibleLayout(fn) {
  const was = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() { return document.body; },
  });
  return Promise.resolve(fn()).finally(() => {
    if (was) Object.defineProperty(HTMLElement.prototype, "offsetParent", was);
    else delete HTMLElement.prototype.offsetParent;
  });
}

// ---- Sheet -----------------------------------------------------------------------------

test("a sheet is a modal dialog named by its heading", async () => {
  // aria-modal is what tells a screen reader the rest of the page is out of play, and the
  // name is how it announces what just opened.
  const user = userEvent.setup({ document });
  await draw(<Opener />);
  await user.click(screen.getByRole("button", { name: "Start a thread" }));
  const dialog = screen.getByRole("dialog", { name: "New thread" });
  assert.equal(dialog.getAttribute("aria-modal"), "true");
});

test("opening puts focus on the panel, not on the first field", async () => {
  // Focusing a textarea on a phone throws the keyboard over half the screen before anybody
  // has read what the sheet is for.
  const user = userEvent.setup({ document });
  await draw(<Opener />);
  await user.click(screen.getByRole("button", { name: "Start a thread" }));
  assert.equal(document.activeElement, screen.getByRole("dialog"));
  assert.notEqual(document.activeElement, screen.getByLabelText("Title"));
});

test("closing gives focus back to what opened it", async () => {
  // Dropping focus on <body> leaves somebody tabbing from the top of the page again.
  // Compared by identity inside assert.ok: handing two jsdom nodes to assert.equal makes the
  // failure report serialise the document, which ran the test process out of heap and
  // aborted the whole file instead of naming this test.
  const user = userEvent.setup({ document });
  await draw(<Opener />);
  const opener = screen.getByRole("button", { name: "Start a thread" });
  await user.click(opener);
  await user.keyboard("{Escape}");
  assert.equal(screen.queryByRole("dialog"), null);
  assert.ok(document.activeElement === opener, "focus fell off the page on close");
});

test("Escape closes the sheet and goes no further", async () => {
  // A second Escape listener higher up — the camera has one on window — must not also fire.
  const user = userEvent.setup({ document });
  let closes = 0;
  let outside = 0;
  const onOuterKey = (e) => { if (e.key === "Escape") outside += 1; };
  await draw(<div onKeyDown={onOuterKey}><Opener onClose={() => { closes += 1; }} /></div>);
  await user.click(screen.getByRole("button", { name: "Start a thread" }));
  await user.keyboard("{Escape}");
  assert.equal(closes, 1);
  assert.equal(outside, 0, "Escape went on to close something behind the sheet as well");
});

test("a click on the scrim closes it, a click inside the panel does not", async () => {
  // Tapping outside is the usual way out on a phone; tapping a field inside must not be.
  const user = userEvent.setup({ document });
  let closes = 0;
  await draw(<Opener onClose={() => { closes += 1; }} />);
  await user.click(screen.getByRole("button", { name: "Start a thread" }));

  await user.click(screen.getByLabelText("Title"));
  assert.equal(closes, 0, "a tap inside the panel closed it");
  assert.ok(screen.getByRole("dialog"));

  await user.click(screen.getByRole("dialog").parentElement);
  assert.equal(closes, 1);
});

test("Tab from the last control comes back round to the first", async () => {
  // aria-modal says the outside does not exist; Tabbing out into it would make that false.
  await withVisibleLayout(async () => {
    const user = userEvent.setup({ document });
    await draw(<Opener />);
    await user.click(screen.getByRole("button", { name: "Start a thread" }));
    const post = screen.getByRole("button", { name: "Post" });
    post.focus();
    const carriedOn = fireEvent.keyDown(post, { key: "Tab" });
    assert.equal(carriedOn, false, "Tab was let through to leave the dialog");
    assert.equal(document.activeElement, screen.getByLabelText("Title"));
  });
});

test("Shift+Tab from the first control goes round to the last", async () => {
  // The same trap, the other direction.
  await withVisibleLayout(async () => {
    const user = userEvent.setup({ document });
    await draw(<Opener />);
    await user.click(screen.getByRole("button", { name: "Start a thread" }));
    const title = screen.getByLabelText("Title");
    title.focus();
    const carriedOn = fireEvent.keyDown(title, { key: "Tab", shiftKey: true });
    assert.equal(carriedOn, false, "Shift+Tab was let through to leave the dialog");
    assert.equal(document.activeElement, screen.getByRole("button", { name: "Post" }));
  });
});

test("Tab in the middle of the sheet is left alone", async () => {
  // The trap only acts at the two ends; anywhere else the browser's own order is right.
  await withVisibleLayout(async () => {
    const user = userEvent.setup({ document });
    await draw(<Opener />);
    await user.click(screen.getByRole("button", { name: "Start a thread" }));
    const message = screen.getByLabelText("Your message");
    message.focus();
    assert.equal(fireEvent.keyDown(message, { key: "Tab" }), true);
    assert.equal(document.activeElement, message);
  });
});

// ---- the small pieces ------------------------------------------------------------------

test("the back arrow has a name a screen reader can say", async () => {
  // It is only an arrow on screen; without a label it is announced as "button".
  const user = userEvent.setup({ document });
  let pressed = 0;
  await draw(<BackButton onClick={() => { pressed += 1; }} />);
  await user.click(screen.getByRole("button", { name: "Back" }));
  assert.equal(pressed, 1);
  cleanup();
  await draw(<BackButton label="Back to the storyboard" />);
  assert.ok(screen.getByRole("button", { name: "Back to the storyboard" }));
});

test("the progress bar has five steps, done up to the current one", async () => {
  // The posting flow is five screens; writing the entry is step five.
  const { container } = await draw(<Steps at={2} />);
  const steps = Array.from(container.firstChild.children);
  assert.equal(steps.length, 5);
  assert.deepEqual(steps.map((s) => s.classList.contains("stepDone")), [true, true, false, false, false]);
  assert.deepEqual(steps.map((s) => s.classList.contains("stepOn")), [false, false, true, false, false]);
});

test("a frame slot shows its note only when there is one", async () => {
  // A patch of night with the explanation over it; no note, no empty caption.
  await draw(<Frame label="No real photographs here" />);
  assert.ok(screen.getByText("No real photographs here"));
  cleanup();
  const bare = await draw(<Frame />);
  assert.equal(bare.container.querySelector(".frameNote"), null);
});

test("a spinner says what it is waiting for", async () => {
  // A wheel alone tells nobody what is happening.
  await draw(<Spinner label="Checking…" />);
  assert.ok(screen.getByText("Checking…"));
});
