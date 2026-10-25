# Revised exhibition interaction and visual design

These requirements supersede the earlier control and carousel descriptions. Research remains based on six genuine participants; coding-practice transcripts are excluded.

## Controls and Return

There are exactly three physical navigation controls: Back (ArrowLeft), Choose (Enter) and Next (ArrowRight). Back and Next cycle the available focus options in opposite directions, wrapping at either end. Neither directional control directly changes a story or leaves the screen. Choose activates the highlighted item, answer, story control or destination. Mapping is centralised in `shared/config.js`.

Every secondary display route starts with selectable “← Return to previous screen” and “⌂ Return to home” links. Source/phone handoff panels also contain Return and Home options. The persistent guide reads “Back: previous option · Choose: select · Next: next option · Turn knob: volume”. A double focus outline/shadow identifies the selected item and a separate persistent “Selected” text line names it; focus decoration does not change item geometry or cover guidance.

The knob controls volume only. Default mode is OS volume. Software mode receives the configurable `wn-knob` event with a signed delta and displays the temporary volume state. It does not add navigation keys. Keyboard selection scrolls into view; pointer selection does not move an item under a drag gesture.

## Story reading

The home story provides Previous story, Next story, Read full story and a position such as “Story 1 of 6”. There is no rotation pause/resume control. A 45-second one-shot timer is reset on user input; it changes the story only after inactivity. Reduced-motion preferences disable automatic rotation. Audio and source panels suspend it. Backend polling stages fresh data while the user is interacting rather than replacing the story being read.

`story.html?id=…` is a dedicated full-story view with no carousel timer. A visible full story also suspends the generic idle-to-home transition so that reading is not interrupted. Other secondary pages retain the two-minute idle return, audio stop and volume preservation.

## Images

One original 12-panel illustrated atlas covers all six species, native planting, clean-up, general park scenes, volunteer preparation, pond care and garden habitat. It is encoded to a locally served WebP of approximately 574 KB and cached once. SVG viewports show the appropriate panel without modifying the artwork. Every generated image has descriptive accessible text and an “Original illustration · prototype content” label. The existing licensed brushtail photograph retains attribution. A neutral original park illustration replaces failed images. See IMAGE-ATTRIBUTIONS.md for creator, source/terms, processing and licences; generated imagery is never presented as real sighting/event evidence.

## Learning

Each species page links to one short activity. There are multiple-choice questions, responsible-response questions, habitat/clue matching, and a habitat planning game. Answers produce an explanation, Try again, Learn more and Return to animal page.

The habitat game uses the same item/destination controls for all inputs: Choose picks up an item, Back/Next select a destination, Choose places it; a placed item can be selected again to move it. Live status names the item and destination. “Choose item → Choose destination” is the non-drag alternative. Native pointer dragging also works, including when the page must scroll. No activity scores sightings, rewards approaching animals or exposes exact locations.

## Fencepost hierarchy and community care

The public park entry introduces “Wildlife stories from your neighbourhood”, with a secondary contribution link. It then presents one featured observation, a separate practical-guidance card, recent stories, optional neighbourhood volunteering, and Community Updates. The five main destinations remain Stories, Learn, Share, Help and Community. Browsing needs no identity or account.

Cards use consistent image ratios, status shapes/text, spacing, line length and one primary action. Four sample activities cover planting, pond litter collection, native shelter/garden care and reserve clean-up. Each includes area, unconfirmed date, duration, organiser status, accessibility and a details link. Prototype registration, validation, references, persistence, editing/cancellation/restoration are preserved for every activity; records never go to a real organiser.

Four fictional Community Updates use the requested titles and cautious text: Creating a safer wildlife route, Caring for the park pond, Restoring native shelter, A cleaner reserve entrance. They show illustration, prototype status, broad area, activity/outcome, why it matters, message, no-handling statement, demonstration date and related opportunity. Public-display update lists/details and mobile lists/details are functional.

## Data preservation and deployment

No submissions, registrations or private legacy records are deleted. Existing browser demo catalogues receive additive new samples while retaining user work. The current initial schema includes outcome activity/why/date fields. Existing Supabase installations apply `supabase/003_exhibition_updates.sql`, then the updated idempotent `002_seed.sql`; the upgrade preserves observations and extends outcome publication atomically. Shared files are copied into the existing Next project with `scripts/sync-fencepost.mjs`.

## Verification and limits

Automated tests cover the new mappings and wrap behaviour, Return activation, idle/reduced-motion/full-story behaviour, all quiz types, keyboard pick/place/reposition, native pointer dragging, four sample updates, mobile hierarchy, registration and existing privacy workflows. Screenshots in `docs/screenshots` cover the ten requested views. PostgreSQL tests check the additive upgrade and retained private records; both static validation and the Next production build are run.

The cardboard iPad, actual macro keyboard, knob/speakers, outdoor glare and physical reach still require hands-on testing. Browser checks emulate iPad dimensions but are not hardware certification. Hosted Supabase Auth/Storage remains unconfigured. Official wildlife facts and contacts still need the responsible organisation’s review; the UI does not mislabel unreviewed reference information as verified. Those external limitations are not hidden by sample content.
