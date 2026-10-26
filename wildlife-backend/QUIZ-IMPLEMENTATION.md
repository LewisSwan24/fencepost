# Meet the Animal: multiple-choice correction

## Scope and design

Only the quiz, its entry markup, shared controls/styles, relevant tests and documentation changed. Unrelated display pages and Fencepost hierarchy, contribution, moderation and volunteering remain as before. The shared component is copied into Fencepost so both interfaces use the same quiz rather than leaving the removed games on the companion.

A quiet animal portrait anchors the left side; the question and three large cream answer cards have priority. Forest green carries headings and primary actions, muted orange identifies progress and keyboard focus. Mobile turns the portrait into a compact identity strip. Feedback uses words, the chosen answer, the correct answer and a short explanation, with no colour-only result. The final count is private to the current visit; there are no timers, rankings, rewards or persistent scores.

The old matching, item placement and drag handlers were removed, along with their obsolete styles. All six animals now have three original multiple-choice questions, using varied active-time, habitat, food and behaviour topics. These are educational facts, not resident observations or certain identification of a sighting. No new emergency advice, contact or distance measurement was introduced.

## Files and state

- `shared/quiz-data.js`: all 18 questions, three answers each, one correct index, explanatory text and source title/link per question.
- `shared/quiz-state.js`: selected animal, question, highlight, selection, answer history, feedback, completion and review. The correct answer comes from the question record; the correct count is derived from final choices, so retry cannot inflate it.
- `shared/activities.js`: reusable renderer, answer feedback, retry, completion and expandable answer review. Retry clears the current selection/feedback and returns to its first answer. Restart clears the whole quiz. Changing animal or re-entering the route starts fresh.
- `shared/quiz.css`: quiz-scoped layout, typography, targets, focus and responsive/reduced-motion rules.
- `shared/controls.js`: while a quiz is present, the physical navigation scope consists of its current answers/actions and Return. All other pages retain their existing control order.

Back/ArrowLeft highlights the previous option; Next/ArrowRight highlights the next. Both wrap. Choose/Enter activates it immediately. After an answer, focus moves to Next question, followed by Try again and the always-visible “← Return to Meet the Animal” link to the current animal page. Completion offers Review answers, Try again, Choose another animal and Return. Review begins at the first expandable answer; all three can be read/toggled using the same controls. Sources remain normal links for touch, Tab and screen-reader use. The knob continues to control volume only. Existing display inactivity-to-home behaviour is retained; no quiz timer advances questions or hides feedback.

A persistent polite live region announces question/feedback changes. Text labels explain correctness, answer targets exceed 44 × 44 px, focus is visible, images have descriptive accessible names, and reduced-motion settings disable transitions. A designed park illustration replaces missing artwork and identifies the fallback in its accessible text.

## Images

All six portraits reuse the existing locally hosted original illustrative atlas, `assets/neighbours-illustrations.webp`, cropped with SVG viewports. No new external photographs or unlicensed assets were added. The image label identifies it as illustration. Existing creation/attribution information is in `IMAGE-ATTRIBUTIONS.md`; artwork is never evidence of an actual encounter.

## Factual references

Each question retains the relevant Australian Museum species title and HTTPS link. The sources cover:

| Animal / source | Topics used |
| --- | --- |
| [Common Brushtail Possum](https://australian.museum/learn/animals/mammals/common-brushtail-possum/) | Nocturnal activity, climbing claws, tree-hollow shelter |
| [Grey-headed Flying-fox](https://australian.museum/learn/animals/mammals/grey-headed-flying-fox/) | Day roosting, nectar/pollen/fruit, pollination and seed dispersal |
| [Water Dragon](https://australian.museum/learn/animals/reptiles/water-dragon/) | Waterway habitat, basking, swimming/diving |
| [Australian Magpie](https://australian.museum/learn/animals/birds/australian-magpie/) | Ground foraging, open grassy habitat, varied carolling |
| [Eastern Grey Kangaroo](https://australian.museum/learn/animals/mammals/eastern-grey-kangaroo/) | Grass diet, cooler-hour activity, grassland/open woodland |
| [Blue-tongue Lizard](https://australian.museum/learn/animals/reptiles/blue-tongue-lizard/) | Omnivorous diet, ground cover, defensive tongue display |

These are established species-reference facts, not AI-generated wildlife advice. Requests to these source pages were blocked by the cloud network (403), so a fresh online editorial check is not claimed. The responsible organisation should check source wording and availability before a public installation. No “Verified by a moderator” badge or review date was fabricated.

## Validation and limitations

`npm test` passes 21 tests, including six-animal/18-question structure, source recording, exactly three unique answers, valid correct indices, state transitions, retry/counting, completion, review and reset. `npm run build` validates the static deployment; the copied Next application also builds.

`tests/browser_quiz.py` exercises all six full journeys using only the three navigation keys, plus on-screen physical-control equivalents: both wrapping directions, immediate Choose, wrong/correct feedback, focus transfer, current-question retry, next question, final count, expandable review, full restart, Return, another animal, reload, knob isolation, image load and failure fallback, mobile/iPad layouts, companion touch/keyboard and reduced motion. No unexpected console or JavaScript page errors occurred (the deliberate failed-artwork request is excluded). The built Next `/park` routes were also checked for all six animals, alongside the copied public display. Existing `browser_revision.py` and `browser_journeys.py` regression journeys also pass.

Screenshots are in `docs/screenshots`. No new runtime dependency, environment variable, authentication scheme or backend migration is required. Questions are static client data; refreshing intentionally discards progress. Hardware reach, outdoor glare, actual screen-reader speech and the physical controller/volume knob still require testing on the exhibition installation.
