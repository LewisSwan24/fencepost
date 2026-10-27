import { config } from "./config.js";
import { esc, sourceLink } from "./ui.js";
const phoneIcon =
  '<svg class="contact-phone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M8 3 4 5c-1 5 7 13 12 14l3-4-5-3-2 2-6-6 2-2-3-5Z"/></svg>';
export const contactHref = (contact) => `tel:${contact.number}`;
export const contactLabel = (contact) =>
  contact.kind === "emergency"
    ? `Call ${contact.mnemonic} (${contact.formattedNumber})`
    : `Call ${contact.mnemonic}`;
export const confirmLabel = (contact) =>
  contact.kind === "emergency"
    ? `Call ${contact.number}`
    : `Call ${contact.mnemonic}`;
export function contactOptions(contacts = config.assistanceContacts) {
  return `<div class="assistance-contacts" aria-label="Wildlife assistance and human emergencies">${contacts
    .map(
      (contact) =>
        `<section class="contact-card contact-${esc(contact.kind)}" aria-labelledby="contact-${esc(contact.id)}"><p class="contact-kicker">${esc(contact.kind === "emergency" ? "Immediate emergency" : "Wildlife assistance")}</p><h3 id="contact-${esc(contact.id)}">${esc(contact.heading)}</h3><p>${esc(contact.description)}</p>${contact.kind === "wildlife" ? `<p class="contact-number"><strong>${esc(contact.mnemonic)} — ${esc(contact.formattedNumber)}</strong></p>` : ""}<a class="contact-call" data-contact-id="${esc(contact.id)}" href="${esc(contactHref(contact))}" aria-haspopup="dialog">${phoneIcon}<span>${esc(contactLabel(contact))}</span></a>${contact.warning ? `<p class="contact-warning">${esc(contact.warning)}</p>` : ""}<p class="contact-source">${sourceLink(contact.sourceUrls[0], contact.sourceLabel)}${contact.sourceUrls
          .slice(1)
          .map((url) => `<br>${sourceLink(url, contact.name)}`)
          .join(
            "",
          )}</p><p class="contact-review">Contact details reviewed: <time datetime="${esc(contact.reviewedAt)}">${esc(contact.reviewedAt)}</time></p></section>`,
    )
    .join("")}</div>`;
}
export function mountContactDialogs(
  root,
  contacts = config.assistanceContacts,
) {
  let active = null,
    opener = null;
  function close(restore = true) {
    if (!active) return;
    const dialog = active;
    active = null;
    if (dialog.open) dialog.close();
    dialog.remove();
    if (restore && opener?.isConnected) opener.focus();
    opener = null;
  }
  function click(event) {
    if (event.target.closest("[data-contact-cancel]")) {
      event.preventDefault();
      close();
      return;
    }
    const trigger = event.target.closest("[data-contact-id]");
    if (!trigger || !root.contains(trigger)) return;
    event.preventDefault();
    const contact = contacts.find((c) => c.id === trigger.dataset.contactId);
    if (!contact || !/^\d{3,15}$/.test(contact.number)) return;
    close(false);
    opener = trigger;
    const dialog = document.createElement("dialog");
    active = dialog;
    dialog.className = `contact-dialog contact-${contact.kind}`;
    dialog.setAttribute("aria-labelledby", "contact-dialog-title");
    dialog.setAttribute("aria-describedby", "contact-dialog-description");
    dialog.innerHTML = `<h2 id="contact-dialog-title">${esc(contact.confirmationTitle)}</h2><p id="contact-dialog-description">${esc(contact.confirmationBody)}</p><div class="contact-dialog-actions"><a class="contact-call" data-contact-confirm href="${esc(contactHref(contact))}">${phoneIcon}<span>${esc(confirmLabel(contact))}</span></a><button type="button" data-contact-cancel autofocus>Cancel</button></div>`;
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    root.append(dialog);
    dialog.showModal();
    dialog.querySelector("[data-contact-cancel]").focus();
  }
  function key(event) {
    // The display already handles its three physical keys. The same dialog also
    // supports an attached keyboard on the phone companion, without double handling.
    if (
      !active?.open ||
      document.querySelector("[data-control]") ||
      event.repeat ||
      !["ArrowLeft", "ArrowRight", "Enter"].includes(event.key)
    )
      return;
    const options = [...active.querySelectorAll("a,button")],
      i = options.indexOf(document.activeElement);
    event.preventDefault();
    if (event.key === "Enter") {
      options[i]?.click();
      return;
    }
    options[
      (Math.max(0, i) +
        (event.key === "ArrowRight" ? 1 : -1) +
        options.length) %
        options.length
    ]?.focus();
  }
  root.addEventListener("click", click);
  document.addEventListener("keydown", key);
  return () => {
    close(false);
    root.removeEventListener("click", click);
    document.removeEventListener("keydown", key);
  };
}

export function additionalReviewedContacts(records) {
  return records.filter(
    (contact) =>
      contact.verified === true &&
      contact.sourceUrl &&
      contact.reviewedAt &&
      !config.assistanceContacts.some(
        (standard) =>
          String(contact.phone || "").replace(/\D/g, "") === standard.number,
      ),
  );
}
