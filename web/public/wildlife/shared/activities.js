import { esc, image, setupImages } from "./ui.js";
import { species } from "./data.js";
import { quizzes } from "./quiz-data.js";
import { createQuizState, transition, correctCount } from "./quiz-state.js";
export { quizzes } from "./quiz-data.js";

// One shared multiple-choice experience for the display and its phone companion.
export function mountActivity(
  root,
  speciesId,
  { animalUrl, animalsUrl = "animals.html" } = {},
) {
  let state = createQuizState(speciesId);
  const animal = species.find((s) => s.id === state.speciesId);
  const view = document.createElement("div");
  const announcement = document.createElement("p");
  announcement.className = "quiz-announcement";
  announcement.setAttribute("role", "status");
  announcement.setAttribute("aria-live", "polite");
  announcement.setAttribute("aria-atomic", "true");
  root.replaceChildren(view, announcement);
  animalUrl ||= `species.html?animal=${animal.id}`;
  const illustration = image(
    `illustration:${animal.id}`,
    `${animal.name} shown in its typical habitat`,
    "quiz-art",
  );
  const button = (label, action) =>
    `<button type="button" data-quiz-option data-quiz-action="${action}">${label}</button>`;
  const returnLink = () =>
    `<a class="quiz-return" data-quiz-option href="${esc(animalUrl)}">← Return to Meet the Animal</a>`;
  const source = (q) =>
    `<p class="quiz-source">Wildlife information · <a href="${esc(q.source.url)}" target="_blank" rel="noreferrer">${esc(q.source.title)} ↗</a></p>`;
  function draw(focus = true) {
    const questions = quizzes[state.speciesId],
      q = questions[state.question];
    let content;
    if (state.completed) {
      content = state.reviewing
        ? `<p class="quiz-kicker">A moment to remember</p><h2 id="quiz-title">Your discoveries</h2><ol class="quiz-review">${questions.map((q, i) => `<li><details open><summary data-quiz-option aria-label="Review question ${i + 1}: ${esc(q.prompt)}">${esc(q.prompt)}</summary><p>Your answer: ${esc(q.answers[state.answers[i]])}</p><p><strong>${state.answers[i] === q.correct ? "Correct" : "Correct answer: " + esc(q.answers[q.correct])}</strong></p><p>${esc(q.explanation)}</p>${source(q)}</details></li>`).join("")}</ol><div class="quiz-actions">${button("Back to summary", "summary")}${button("Try again", "restart")}<a data-quiz-option href="${esc(animalsUrl)}">Choose another animal</a></div>${returnLink()}`
        : `<p class="quiz-kicker">Three small discoveries</p><h2 id="quiz-title">A little more familiar</h2><p class="quiz-total">${correctCount(state)} of 3 correct</p><p>Every new detail helps us understand our wildlife neighbours. Take another look whenever you like.</p><div class="quiz-actions">${button("Review answers", "review")}${button("Try again", "restart")}<a data-quiz-option href="${esc(animalsUrl)}">Choose another animal</a></div>${returnLink()}`;
    } else {
      content = `<p class="quiz-kicker">Question ${state.question + 1} of 3 · ${esc(animal.name)}</p><div class="quiz-progress" aria-hidden="true">${questions.map((_, i) => `<span class="${i <= state.question ? "is-filled" : ""}"></span>`).join("")}</div><h2 id="quiz-title">${esc(q.prompt)}</h2>`;
      if (!state.feedback)
        content += `<div class="quiz-answers" role="group" aria-label="Choose one answer">${q.answers.map((a, i) => `<button type="button" data-quiz-option data-quiz-answer="${i}"><span class="answer-letter" aria-hidden="true">${"ABC"[i]}</span><span>${esc(a)}</span></button>`).join("")}</div><p class="quiz-hint">Back or Next highlights an option. Choose selects it.</p>${returnLink()}`;
      else
        content += `<section class="quiz-feedback" aria-labelledby="quiz-feedback-title"><h3 id="quiz-feedback-title">${state.selected === q.correct ? "Correct" : "Not quite"}</h3><p>You chose: ${esc(q.answers[state.selected])}</p><p><strong>Correct answer: ${esc(q.answers[q.correct])}</strong></p><p>${esc(q.explanation)}</p></section>${source(q)}<div class="quiz-actions">${button(state.question === 2 ? "Next question — see summary" : "Next question", "next")}${button("Try again", "retry")}</div>${returnLink()}`;
    }
    view.innerHTML = `<section class="animal-quiz" data-quiz-controls aria-label="${esc(animal.name)} multiple-choice quiz"><aside class="quiz-portrait">${illustration}<p>Meet the animal<br><strong>${esc(animal.name)}</strong></p></aside><div class="quiz-content">${content}</div></section>`;
    root.querySelector("svg.art image")?.addEventListener(
      "error",
      () => {
        const svg = root.querySelector("svg.art");
        if (!svg) return;
        svg.setAttribute(
          "aria-label",
          "Designed park illustration; animal artwork unavailable",
        );
        svg.querySelector("title").textContent =
          "Designed park illustration; animal artwork unavailable";
      },
      { once: true },
    );
    setupImages(root);
    announcement.textContent = state.completed
      ? state.reviewing
        ? "Review all three answers and explanations."
        : `${correctCount(state)} of 3 correct. Every new detail helps us understand our wildlife neighbours.`
      : state.feedback
        ? `${state.selected === q.correct ? "Correct." : "Not quite."} Correct answer: ${q.answers[q.correct]}. ${q.explanation}`
        : `Question ${state.question + 1} of 3. ${q.prompt}`;
    // Source links remain available to Tab/touch. Physical keys stay with the
    // answer/action options and Return; they never open an external site.
    if (focus)
      root.querySelector("[data-quiz-option]")?.focus({ preventScroll: true });
  }
  function click(e) {
    const el = e.target.closest("[data-quiz-option]");
    if (!el || !root.contains(el)) return;
    if (el.hasAttribute("data-quiz-answer"))
      state = transition(state, "answer", Number(el.dataset.quizAnswer));
    else if (el.dataset.quizAction)
      state = transition(state, el.dataset.quizAction);
    else return;
    draw();
  }
  function focus(e) {
    const options = [...root.querySelectorAll("[data-quiz-option]")];
    const i = options.indexOf(e.target);
    if (i >= 0) state = transition(state, "highlight", i);
  }
  function key(e) {
    // The public display already owns these keys; the companion uses the same
    // navigation when a keyboard/controller is attached.
    if (
      document.querySelector("[data-control]") ||
      e.repeat ||
      !["ArrowLeft", "ArrowRight", "Enter"].includes(e.key)
    )
      return;
    if (e.key === "Enter" && e.target.closest?.(".quiz-source a")) return;
    e.preventDefault();
    const options = [...root.querySelectorAll("[data-quiz-option]")];
    let i = options.indexOf(document.activeElement);
    if (e.key === "Enter") {
      (options[i] || options[0])?.click();
      return;
    }
    i =
      (i + (e.key === "ArrowRight" ? 1 : -1) + options.length) % options.length;
    options[i]?.focus();
  }
  root.addEventListener("click", click);
  root.addEventListener("focusin", focus);
  document.addEventListener("keydown", key);
  draw();
  return () => {
    root.removeEventListener("click", click);
    root.removeEventListener("focusin", focus);
    document.removeEventListener("keydown", key);
  };
}
