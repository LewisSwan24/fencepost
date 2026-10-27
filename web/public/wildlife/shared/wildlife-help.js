import { esc, sourceLink } from "./ui.js";
import { config } from "./config.js";
import {
  starterPrompts,
  helpTransparency,
  offlineNotice,
  descriptionIssue,
  offlineGuidance,
  safeFallback,
  validateGuidance,
  safetySignals,
} from "./wildlife-help-policy.js";
export function mountWildlifeHelp(root) {
  root.innerHTML = `<section class="wildlife-help" aria-labelledby="wildlife-help-heading"><p class="eyebrow">AI Help · observation guidance</p><h2 id="wildlife-help-heading">Describe what you noticed</h2><p>Tell us what you can safely see. AI will help you understand the possible urgency and suggest a next step.</p><div class="wildlife-input"><label for="wildlife-description">What can you safely see?</label><textarea id="wildlife-description" data-help-option aria-label="Describe what you noticed" maxlength="600" rows="4" placeholder="For example: “The possum is lying beside the road and is not moving.”" aria-describedby="wildlife-privacy wildlife-transparency"></textarea><p id="wildlife-privacy" class="small">Describe the animal only. Leave out names, contact details, exact addresses and wildlife locations. Only general signs are sent to AI; your text is not sent or saved.</p><div class="wildlife-prompts" role="group" aria-label="Suggested prompts">${starterPrompts.map((text, i) => `<button type="button" data-help-option data-help-prompt="${i}">${esc(text)}</button>`).join("")}</div></div><div class="wildlife-actions"><button type="button" data-help-option data-help-action="edit">Edit description</button><button type="button" data-help-option data-help-action="ask">Ask AI</button><button type="button" data-help-option data-help-action="clear">Clear text</button><button type="button" data-help-option data-help-action="restart">Start again</button><a data-help-option href="index.html">← Return</a></div><p id="wildlife-transparency" class="wildlife-transparency">${helpTransparency}</p><div class="wildlife-help-status" role="status" aria-live="polite" aria-atomic="true"></div><div class="wildlife-help-result"></div></section>`;
  const field = root.querySelector("textarea"),
    status = root.querySelector("[role=status]"),
    result = root.querySelector(".wildlife-help-result"),
    ask = root.querySelector("[data-help-action=ask]");
  let controller,
    generation = 0,
    disposed = false;
  function clear() {
    root.querySelector(".wildlife-help").removeAttribute("data-result");
    generation++;
    controller?.abort();
    controller = null;
    status.removeAttribute("data-ready");
    field.value = "";
    result.replaceChildren();
    status.textContent = "";
    ask.disabled = false;
  }
  function show(guidance) {
    const offline = guidance.mode !== "live";
    result.innerHTML = `${offline ? `<p class="wildlife-offline">${offlineNotice}</p>` : ""}<section class="wildlife-response" aria-labelledby="wildlife-response-heading"><p class="eyebrow">Possible urgency</p><h3 id="wildlife-response-heading">${esc(guidance.category)}</h3><p>${esc(guidance.explanation)}</p><dl><dt>What to do now</dt><dd>${esc(guidance.now)}</dd><dt>What to avoid</dt><dd>${esc(guidance.avoid)}</dd><dt>Professional assistance</dt><dd>${esc(guidance.professional)}</dd></dl><p class="small">${esc(guidance.uncertainty)}</p>${sourceLink(guidance.source.url, guidance.source.title)}</section>`;
    root.querySelector(".wildlife-help").setAttribute("data-result", "true");
    root.querySelector("[data-help-action=edit]").focus();
    status.dataset.ready = "true";
    status.textContent = `${guidance.category}. ${guidance.explanation}`;
    result.scrollIntoView({ block: "start" });
  }
  async function submit() {
    if (ask.disabled) return;
    status.removeAttribute("data-ready");
    const description = field.value.trim(),
      issue = descriptionIssue(field.value);
    if (issue) {
      status.textContent = issue;
      result.replaceChildren();
      return;
    }
    const current = ++generation;
    controller = new AbortController();
    const requestController = controller;
    ask.disabled = true;
    result.replaceChildren();
    status.textContent = "Reviewing your description…";
    root.querySelector("[data-help-action=restart]").focus();
    let timeout;
    try {
      let guidance;
      if (!config.wildlifeHelpEndpoint) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        guidance = offlineGuidance(description);
      } else {
        const request = fetch(config.wildlifeHelpEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signs: safetySignals(description) }),
          signal: controller.signal,
          cache: "no-store",
          credentials: "omit",
        });
        const deadline = new Promise((_, reject) => {
          timeout = setTimeout(() => {
            requestController.abort();
            reject(Error("timeout"));
          }, 10000);
        });
        const response = await Promise.race([request, deadline]);
        if (disposed || current !== generation) return;
        if (response.status === 400) {
          status.textContent =
            "Remove personal information or precise locations and describe only the animal.";
          return;
        }
        if (response.status === 429) {
          show(safeFallback(description));
          status.removeAttribute("data-ready");
          status.textContent =
            "Please wait a moment before asking again. Safe guidance is shown below.";
          return;
        }
        if (!response.ok) throw Error("unavailable");
        const raw = await response.json();
        guidance =
          validateGuidance(raw, description) || safeFallback(description);
      }
      if (!disposed && current === generation) show(guidance);
    } catch {
      if (!disposed && current === generation)
        show(offlineGuidance(description));
    } finally {
      clearTimeout(timeout);
      if (current === generation) ask.disabled = false;
    }
  }
  function click(e) {
    const target = e.target.closest("[data-help-prompt],[data-help-action]");
    if (!target || !root.contains(target)) return;
    if (target.hasAttribute("data-help-prompt")) {
      clear();
      field.value = starterPrompts[Number(target.dataset.helpPrompt)];
      status.textContent =
        "Prompt added. Choose Ask AI, or edit the description on the touchscreen.";
    } else if (target.dataset.helpAction === "ask") submit();
    else if (target.dataset.helpAction === "edit") {
      edit();
      field.focus();
    } else {
      clear();
      field.focus();
    }
  }
  function edit() {
    root.querySelector(".wildlife-help").removeAttribute("data-result");
    status.removeAttribute("data-ready");
    generation++;
    controller?.abort();
    ask.disabled = false;
    result.replaceChildren();
    status.textContent = "";
  }
  function leave() {
    clear();
  }
  function hidden() {
    if (document.hidden) clear();
  }
  document.addEventListener("visibilitychange", hidden);
  root.addEventListener("click", click);
  field.addEventListener("input", edit);
  window.addEventListener("pagehide", leave);
  window.addEventListener("wn-idle", leave);
  return () => {
    disposed = true;
    clear();
    document.removeEventListener("visibilitychange", hidden);
    root.removeEventListener("click", click);
    field.removeEventListener("input", edit);
    window.removeEventListener("pagehide", leave);
    window.removeEventListener("wn-idle", leave);
    root.replaceChildren();
  };
}
