# Validation and demonstration checklist

## Executed

- Static build validation: passed.
- Eight Node data/security-behaviour tests: passed.
- Fencepost existing frontend suite: 524 passed, zero failed, with `TZ=Australia/Brisbane`. The same suite without the expected timezone exposed an existing calendar-boundary expectation; no unrelated date implementation was changed.
- Fencepost production build: passed after bundling the same Figtree/Caprasimo font families locally.
- Chromium: text-only Not sure observation → preview → pending hidden publicly → moderator checks/approval → public story visible; no private rescue location in feed.
- Chromium: optional photograph → preview/private moderator image → rejection; rejected description absent from public projection.
- Chromium: private welfare report exact location absent from public preview and display.
- Chromium: registration inline validation, reference, persistence after refresh, editing, cancellation, restoration.
- Chromium: physical Next/Choose complete a species activity; Back moves to the previous option; selectable Return activates the parent route; idle clock returns home. All nine display routes have a visible current selection.
- Chromium: Community Update with optional reviewed image; completed activity stops accepting registration; software volume changes without navigation; missing-image fallback, empty feed and configured-backend failure states.
- Chromium: correct park/story and opportunity QR data with generated SVG; source/handoff panel closes by highlighting Return and activating Choose.
- Chromium: 390-pixel mobile overflow checks; no JavaScript page errors in exercised journeys.
- PostgreSQL 17: current schema applied successfully against auth/storage test shims; seeded six public stories and four private observations. Seed run twice without duplicates.
- SQL outcome/storage assertions: anonymous pending-media reads return no rows; anonymous approved-media writes fail; moderator outcome publication atomically completes the activity and closes registrations.
- SQL security assertions: anonymous private observation/audit access refused; anonymous moderation refused; authenticated nonmoderator sees no private rows and cannot publish; moderator approval creates a public projection without exact rescue location; rejection retracts it; transaction rolled back.

## Before public installation

- [ ] Configure a test Supabase project on both preview deployments; test actual Auth login, RLS and Storage APIs across two devices.
- [ ] Confirm every official source, common/scientific name and rescue contact with the responsible wildlife organisation; record review dates.
- [ ] Review the original generated animal illustrations for educational suitability; labels and provenance are supplied in IMAGE-ATTRIBUTIONS.md.
- [ ] Test a supported MP4/WebM on real iPad hardware (first-frame extraction can differ by codec); both image conversion and an actual browser-recorded WebM-to-JPEG conversion passed in Chromium.
- [ ] Check all control targets, focus, font scaling, contrast, screen-reader errors and source overlays on the final kiosk dimensions.
- [ ] Test Back/Choose/Next on the actual USB macro keyboard and OS volume knob; verify speaker level, narration pause, idle audio stop and seated/child reach.
- [ ] Repeat empty-feed and backend-failure checks against the actual hosted backend; local intercepted-failure checks passed.
- [ ] Exercise comments pending → approval → report → removal, contributor removal request and outcome publication with the responsible moderator.
- [ ] Confirm opportunity organiser, date, official registration/contact, accessibility, safety and review date before allowing a verified badge.
- [ ] Use only fictional details for local registration; agree a privacy/retention and messaging approach before real registration.
- [ ] Review both branch diffs; deploy previews, verify QR destinations on a real phone, then decide whether to merge.

The committed browser tests require Python Playwright and `/usr/bin/chromium`. Set the executable path for another operating system if needed. They create data in an isolated browser context and do not mutate production services.

## Revised acceptance evidence

`browser_revision.py` exercises Back/Next wrap, Choose/Return, idle-only rotation, reduced-motion, uninterrupted full-story reading, all quiz types, keyboard habitat item placement/repositioning, pointer drag, four sample updates, mobile hierarchy and additional-activity registration at iPad/mobile dimensions. The additive SQL upgrade preserves the four existing private sample observations and adds four detailed sample updates. Actual cardboard hardware is not available in the cloud and remains a manual check.

The 524 existing Fencepost frontend tests were rerun after this revision and passed. Native pointer dragging also passed at 1280×720, 1024×768 and 1440×1080 using a drag gesture started before scrolling to the target. The final screenshots are indexed in docs/screenshots/README.md.
