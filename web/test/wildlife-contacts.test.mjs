import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contactOptions,
  mountContactDialogs,
} from "../public/wildlife/shared/contacts.js";

// jsdom has <dialog> but not its modal methods.
const Dialog = document.createElement("dialog").constructor.prototype;
Dialog.showModal ||= function () {
  this.setAttribute("open", "");
};
Dialog.close ||= function () {
  this.removeAttribute("open");
};

function openFirstCall(options) {
  const root = document.createElement("main");
  document.body.append(root);
  root.innerHTML = contactOptions();
  const cleanup = mountContactDialogs(root, undefined, options);
  root.querySelector("[data-contact-id]").click();
  const dialog = root.querySelector("dialog");
  return {
    dialog,
    done() {
      cleanup();
      root.remove();
    },
  };
}

test("the park display shows a call as a QR to scan, never a tel: link", () => {
  let openedWith = null;
  const { dialog, done } = openFirstCall({
    callAction: (c) => `<div data-qr="tel:${c.number}"></div>`,
    opened: (d) => (openedWith = d),
  });
  assert.equal(dialog.querySelectorAll('a[href^="tel:"]').length, 0);
  assert.match(dialog.querySelector("[data-qr]").dataset.qr, /^tel:\d+$/);
  assert.equal(openedWith, dialog);
  assert.ok(dialog.querySelector("[data-contact-cancel]"));
  done();
});

test("the phone companion still dials from the confirmation", () => {
  const { dialog, done } = openFirstCall();
  assert.equal(dialog.querySelectorAll('a[href^="tel:"]').length, 1);
  assert.equal(dialog.querySelector("[data-qr]"), null);
  done();
});
