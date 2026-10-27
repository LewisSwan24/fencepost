# Validation and demonstration checklist

## Executed

- Static build validation: passed.
- Twenty-one Node data/security/quiz tests: passed.
- Fencepost existing frontend suite: 515 passed, zero failed, with `TZ=Australia/Brisbane`. The same suite without the expected timezone exposed an existing calendar-boundary expectation; no unrelated date implementation was changed.
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
- [ ] Exercise comments immediate publication → report → removal/restoration, contributor removal request and outcome publication with the responsible moderator.
- [ ] Confirm opportunity organiser, date, official registration/contact, accessibility, safety and review date before allowing a verified badge.
- [ ] Use only fictional details for local registration; agree a privacy/retention and messaging approach before real registration.
- [ ] Review both branch diffs; deploy previews, verify QR destinations on a real phone, then decide whether to merge.

The committed browser tests require Python Playwright and `/usr/bin/chromium`. Set the executable path for another operating system if needed. They create data in an isolated browser context and do not mutate production services.

## Revised acceptance evidence

`browser_revision.py` exercises Back/Next wrap, Choose/Return, idle-only rotation, reduced-motion, uninterrupted full-story reading, multiple-choice answer/feedback/retry, four sample updates, mobile hierarchy and additional-activity registration at iPad/mobile dimensions. The additive SQL upgrade preserves the four existing private sample observations and adds four detailed sample updates. Actual cardboard hardware is not available in the cloud and remains a manual check.

The Fencepost frontend suite and build are rerun for the current manual-observation workflow. The later multiple-choice correction removes all pointer dragging; its full evidence is in QUIZ-IMPLEMENTATION.md. The final screenshots are indexed in docs/screenshots/README.md.

## Account/comment/manual-observation verification

The account and direct-comment correction passes 21 Node tests and the 515-test Fencepost suite. Browser journeys cover guest browsing, both demo accounts, quick-fill without automatic login, wrong passwords, refresh/logout, role-protected routes, owner-only views, immediate comments, own edits/deletions, report-without-hiding, moderator removal/restoration, post approval, reset, and mobile layout. `tests/direct-comments-security.sql` passed against PostgreSQL auth/storage shims: guests cannot comment, residents cannot edit another author or read private rescue fields, comments are immediately visible, reports do not hide them, and moderator remove/restore actions are audited. Hosted Supabase-service connectivity still requires configuration.

## Multiple-choice correction

All six animals now have three sourced questions and three choices each. The 21-test Node suite, static validation and dedicated `browser_quiz.py` journeys pass. Existing public/story/registration regressions pass. See QUIZ-IMPLEMENTATION.md for the feature-only change, image origins, source links and remaining installation checks.

## Manual observation verification

The current static suite passes 21 tests and the Fencepost frontend suite passes 515 tests. The Python suite runs 494 tests successfully (493 pass, one existing check skips because the excluded docs/data-model.md source is unavailable). Its pre-existing HTTP test fixtures emit unclosed-socket ResourceWarnings; no application/build warning was introduced by the removal.

`browser_manual_observation.py` passes against both the static companion and the production-built Next /park route: guest text-only input, public preview, edit, cancellation and clean restart, Sent for review, resident optional photograph retained through edit, and private moderator media viewing. No assistant endpoint is requested and no console/page errors occur. `browser_accounts.py` and `browser_revision.py` also pass, covering accounts, immediate comments/reports, post approval, volunteer registration, updates and three-button navigation. The current form screenshot is docs/screenshots/15-manual-observation.png; no helper placeholder or gap remains.

PostgreSQL checks passed on an upgrade from migration 004 and on a fresh schema through migration 005. Authorship, private-location projection and direct-comment moderation tests pass. The obsolete metadata column is absent after migration 005; submitted text and other records are preserved. The retired backend role is rejected before a model call. The Next production build and static validation pass.

## Public-display Wildlife Help

The current local guidance checks cover the six prompts and four categories, exact uncertain-response wording, high-risk priority, privacy protection, no remote requirements and no visible misleading assessment wording. `browser_wildlife_help.py` covers input, loading/cancellation, editing, three-button navigation, Return, idle/visibility clearing, zero API requests, mobile layout and no console errors. The retired feature route is absent from the built Next app. See DISPLAY-HELP.md for the predefined logic, source and limitations.

## Wildlife and emergency contact confirmation

The current suite passes 30 display tests and 515 Fencepost frontend tests; both builds pass. `browser_contacts.py` checks both views, distinct contact purposes, correct telephone links, confirmation before activation, safe initial focus, physical-key wrapping/Choose, touch Cancel, Escape, focus restoration and mobile overflow. The telephone handler is intercepted in tests; no real calls are made. Built-preview checks also pass the local Wildlife Help wording, the retired route returning 404 and contact confirmations, with no console errors. Manual observation journeys still pass. See CONTACTS.md for the source-check limitation and physical dialler check.
