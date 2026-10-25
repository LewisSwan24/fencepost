import { esc, image } from "./ui.js";
export const quizzes = {
  brushtail: {
    type: "choice",
    title: "When does a brushtail possum explore?",
    question: "When are brushtail possums usually most active?",
    answers: ["During the night", "Only at midday", "Only during heavy rain"],
    correct: 0,
    explanation:
      "Brushtail possums are mostly nocturnal. Watch quietly from a distance; never follow or feed them.",
  },
  "flying-fox": {
    type: "match",
    title: "Match the animal to its habitat",
    items: [
      "Grey-headed flying fox",
      "Australian magpie",
      "Eastern water dragon",
    ],
    zones: [
      "Flowering tree canopy",
      "Open grassy ground",
      "Pond-edge vegetation",
    ],
    correct: [0, 1, 2],
    explanation:
      "Flying foxes feed among flowering trees, magpies forage on open ground, and water dragons use vegetation near water. These are broad habitat clues, not identification proof.",
  },
  "water-dragon": {
    type: "habitat",
    title: "Build a thoughtful habitat scene",
    items: [
      "Native shrub",
      "Connected tree branch",
      "Closed rubbish bin",
      "Loose rubbish",
      "Uncontrolled dog",
      "Bright unnecessary lighting",
    ],
    zones: ["May support wildlife", "Needs safe management"],
    correct: [0, 0, 0, 1, 1, 1],
    explanation:
      "Native plants and connected vegetation may provide shelter. Closed bins help keep rubbish contained. Loose rubbish, uncontrolled pets and unnecessary lighting can create risks. Follow organiser advice; never handle wildlife.",
  },
  magpie: {
    type: "choice",
    title: "A magpie’s lunch",
    question: "What does an Australian magpie naturally forage for?",
    answers: [
      "Insects and other small animals",
      "Bread left by visitors",
      "Plastic food wrappers",
    ],
    correct: 0,
    explanation:
      "Magpies forage for insects and other small animals. Let them find their own food; feeding wildlife can harm their health and change their behaviour.",
  },
  kangaroo: {
    type: "choice",
    title: "A responsible response",
    question: "You notice a kangaroo near a road. What is the safest response?",
    answers: [
      "Keep clear of traffic and stop only when safe",
      "Photograph it while driving",
      "Try to move it by hand",
    ],
    correct: 0,
    explanation:
      "Keep yourself and others safe. Never photograph or complete forms while driving, and do not approach or handle the animal. Seek professional advice if it may be injured.",
  },
  "blue-tongue": {
    type: "match",
    title: "Match a behaviour clue",
    items: ["Blue-tongued lizard", "Brushtail possum", "Australian magpie"],
    zones: [
      "Basking beside leaf litter",
      "Climbing trees at night",
      "Foraging on grassy ground",
    ],
    correct: [0, 1, 2],
    explanation:
      "These are typical behaviour clues, not certain identifications. Many animals share habitats and behaviours. Observe from a distance and keep pets away.",
  },
};
// Buttons and destinations are the non-drag alternative. No additional key is needed.
export function mountActivity(
  root,
  speciesId,
  { animalUrl, learnUrl = animalUrl } = {},
) {
  const quiz = quizzes[speciesId] || quizzes.brushtail;
  let selected = null,
    holding = null,
    placements = {},
    result = false,
    message = "Choose an item, then choose a destination.";
  function draw(focusKey) {
    const links = `<div class="activity-links"><a href="${esc(learnUrl)}">Learn more</a><a href="${esc(animalUrl)}">← Return to animal page</a></div>`;
    let html = `<section class="mini-game" aria-label="${esc(quiz.title)}"><p class="eyebrow">One small discovery / ${quiz.type === "choice" ? "Mini quiz" : quiz.type === "match" ? "Match the clue" : "Habitat mini-game"}</p><h2>${esc(quiz.title)}</h2>`;
    if (quiz.type === "choice")
      html += `<p>${esc(quiz.question)}</p><div class="quiz-answers">${quiz.answers.map((answer, i) => `<button type="button" data-game="answer" data-index="${i}" aria-pressed="${selected === i}">${selected === i ? "✓ Selected: " : ""}${esc(answer)}</button>`).join("")}</div><button type="button" data-game="check" ${selected === null ? "disabled" : ""}>Submit selected answer</button>`;
    else
      html += `${quiz.type === "habitat" ? `<div class="habitat-scene">${image("illustration:park", "An illustrative neighbourhood habitat scene")}<p>Your habitat plan: place supportive items and identify risks to manage safely.</p></div>` : ""}<p>Choose item → Choose destination. You can also drag an item. Choose a placed item again to reposition it.</p><p class="game-announcement" role="status" aria-live="polite">${esc(message)}</p><div class="game-items" aria-label="Choose item">${quiz.items.map((item, i) => `<button type="button" draggable="true" data-game="item" data-index="${i}" aria-pressed="${holding === i}" ${holding !== null ? "disabled" : ""}><span aria-hidden="true">${quiz.type === "habitat" ? ["♧", "⌁", "▣", "⚠", "⚠", "☼"][i] : "◇"}</span> Choose item: ${esc(item)}<small>${placements[i] !== undefined ? "Placed: " + esc(quiz.zones[placements[i]]) : "Not placed yet"}</small></button>`).join("")}</div><div class="drop-zones" aria-label="Choose destination">${quiz.zones
        .map(
          (zone, i) =>
            `<button type="button" class="drop-zone" data-game="zone" data-index="${i}" ${holding === null ? "disabled" : ""}><strong>Choose destination: ${esc(zone)}</strong><span>${
              Object.entries(placements)
                .filter(([, z]) => z === i)
                .map(([item]) => esc(quiz.items[item]))
                .join(" · ") || "No items placed"
            }</span></button>`,
        )
        .join(
          "",
        )}</div>${holding !== null ? '<button type="button" data-game="cancel">Choose a different item</button>' : ""}<button type="button" data-game="check" ${Object.keys(placements).length === quiz.items.length ? "" : "disabled"}>Check ${quiz.type === "habitat" ? "habitat choices" : "matches"}</button>`;
    if (result) {
      const correct =
        quiz.type === "choice"
          ? selected === quiz.correct
          : quiz.correct.every((zone, i) => placements[i] === zone);
      html += `<section class="quiz-result" role="status" tabindex="-1"><h3>${correct ? "Thoughtful choices!" : "Let’s look at the clues together."}</h3><p>${esc(quiz.explanation)}</p><button type="button" data-game="reset">Try again</button>${links}</section>`;
    } else html += links;
    root.innerHTML = html + "</section>";
    if (focusKey) root.querySelector(focusKey)?.focus();
  }
  function pick(i, mouse = false) {
    holding = i;
    result = false;
    message = `Picked up ${quiz.items[i]}. Choose a destination.`;
    if (!mouse) draw('[data-game="zone"]');
    else {
      root.querySelector(".game-announcement").textContent = message;
      root
        .querySelectorAll("[data-game=zone]")
        .forEach((z) => (z.disabled = false));
    }
  }
  function place(i) {
    if (holding === null) return;
    const item = holding;
    placements[item] = i;
    holding = null;
    result = false;
    message = `Placed ${quiz.items[item]} in ${quiz.zones[i]}. Choose this item again to move it.`;
    draw(`[data-game="item"][data-index="${item}"]`);
  }
  function click(e) {
    const button = e.target.closest("[data-game]");
    if (!button || !root.contains(button)) return;
    const a = button.dataset.game,
      i = Number(button.dataset.index);
    if (a === "answer") {
      selected = i;
      result = false;
      draw(`[data-game="answer"][data-index="${i}"]`);
    }
    if (a === "item") pick(i);
    if (a === "zone") place(i);
    if (a === "cancel") {
      holding = null;
      message = "Choose another item.";
      draw('[data-game="item"]');
    }
    if (a === "check") {
      result = true;
      draw(".quiz-result [data-game=reset]");
    }
    if (a === "reset") {
      selected = null;
      holding = null;
      placements = {};
      result = false;
      message = "Choose an item, then choose a destination.";
      draw('[data-game="answer"],[data-game="item"]');
    }
  }
  function drag(e) {
    const item = e.target.closest('[data-game="item"]');
    if (item) {
      pick(Number(item.dataset.index), true);
      e.dataTransfer.setData("text/plain", item.dataset.index);
      e.dataTransfer.effectAllowed = "move";
    }
  }
  function drop(e) {
    const zone = e.target.closest('[data-game="zone"]');
    if (zone) {
      e.preventDefault();
      place(Number(zone.dataset.index));
    }
  }
  function end() {
    if (holding !== null) draw("[data-game=zone]");
  }
  function over(e) {
    if (e.target.closest('[data-game="zone"]')) e.preventDefault();
  }
  root.addEventListener("click", click);
  root.addEventListener("dragstart", drag);
  root.addEventListener("dragover", over);
  root.addEventListener("dragend", end);
  root.addEventListener("drop", drop);
  draw();
  return () => {
    root.removeEventListener("click", click);
    root.removeEventListener("dragstart", drag);
    root.removeEventListener("dragover", over);
    root.removeEventListener("dragend", end);
    root.removeEventListener("drop", drop);
  };
}
