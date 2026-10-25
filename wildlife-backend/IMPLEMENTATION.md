# Implementation delivery report

## System and files

The display keeps the existing static technology and theme, adding a shared browser data/API layer, a Supabase migration and a responsive Fencepost park flow. The actual Fencepost source was inspected and modified on `wildlife-neighbours-preview`; its Next.js framework, legacy components, routes, tests and Python/Turso services are retained. New root/park routes reuse the same shared workflow; anonymous park browsing bypasses the legacy name gate. The original dashboard moves to `/legacy`, with its regression tests now importing `LegacyHome`.

- `app.js`, nine HTML entry points and `styles.css`: four-zone display, dynamic approved stories, help, six species and secondary action.
- `shared/config.js`: single hardware mapping, public backend configuration, idle/rotation and contact requirements.
- `shared/data.js`, `models.d.ts`: six species, six fictional approved stories, pending/rejected/uncertain/welfare examples, four sample activities and four sample Community Updates.
- `shared/api.js`: explicit local/connected adapters, safe public projection, moderator auth, submission/media, moderation, comments, sources and outcomes.
- `shared/mobile.js`/`mobile.css`, `fencepost/index.html`: mobile hash routes and complete demo state transitions.
- `shared/controls.js`: three-button input, focus cycling, source-overlay Back, idle and configurable volume.
- `supabase/001_schema.sql`, `002_seed.sql`, `scripts/seed.mjs`: isolated backend and reproducible sample content.
- `vendor/qrcode.js`: locally generated destination-specific QR codes, retained MIT notice.
- `scripts/sync-fencepost.mjs`: reproducible copy into the existing Next application; no framework migration.
- Tests and deployment documentation described in README.

## Data and security

Tables: `moderators`, `observations`, `public_stories`, `moderation_records`, `opportunities`, `outcomes`, `information_sources`, `comments`, `comment_reports`, `removal_requests`. Registration data intentionally remains browser-local demo-only, as allowed by the brief; there is no real organiser endpoint.

RLS is enabled on all new tables. Anonymous callers can read only the deliberately public projections: approved public stories, published outcomes, visible comments, opportunity and source configuration. They cannot read private observations, audit trails, reports or removal requests. Anonymous submission uses a constrained security-definer RPC that sets pending/urgent status itself; clients cannot submit approved status. Moderator access requires both Supabase Auth and membership in the private moderator table. Nonmoderator authenticated accounts cannot read the private queue or publish. Human approval requires all five privacy checks, reason, broad-area enum and public wording. The transaction creates/updates a separate public story record with no nickname, exact rescue location or private condition fields; it logs moderator UUID, action, reason and timestamp. Rejection/removal retracts the story. Public prose is manually reviewed: no automatic redaction tool is presented as a replacement for a human.

The private pending-media bucket accepts only re-encoded JPEGs. Moderators receive short-lived preview URLs, and explicitly approved images are re-encoded again and copied to the public bucket. Removing/rejecting media deletes stored media through moderator-authorised requests. Storage policies deny anonymous reading of pending media. Browser code uses only the public anon key; no service-role key is stored or requested.

Local demo mode cannot provide privacy/security between people using the same browser and origin. It is intentionally labelled and is not a deployment substitute for RLS and Auth. Browser-held receipts enable removal requests; no automatic rescue dispatch, messaging or organiser notification is claimed.

## Journeys and moderation

Browse anonymously → story detail separates resident observation, source-linked reference, safe response and privacy notes → learn species and one short quiz or matching/habitat activity → help situations. No phone is necessary for display learning or guidance.

Share text or optional image/video still → preview and edit/cancel → Sent for review → moderator edits public wording/species/area, checks privacy and chooses approval, rejection, clarification, urgent or removal → public display updates (storage event locally; 30-second public-feed poll when connected). Clarification is recorded for demonstration, with no invented notification channel.

Community → sample opportunity details with organiser/date/accessibility/equipment/safety → prototype register-interest form → reference → persist/view/edit/cancel/restore/new registration. No real booking claim. Moderator can publish a Community Update without fabricated volunteer numbers, animal use or environmental-impact claims. Cards are explicitly Observation (1), Approved Story (2), Opportunity (4), Outcome (3).

## Research → feature

| Supplied evidence | Response |
| --- | --- |
| Six participants cared but lacked confidence | Practical help situations and safe-observation guidance |
| Five of six could not research mid-encounter | Persistent help and footer; no mandatory phone handoff |
| Professional sources preferred | Reference labels, source URLs, explicit review status; no AI advice |
| Four concept reviewers expected to browse | Approved stories at the mobile root; no identity/account gate |
| Lightweight contribution | Text-only, optional nickname and optional media |
| Five of five asked for review wanted humans | Private pending queue, five-check review, identified reviewer and audit |
| Five of six favoured broad public location | Area/time enums; private rescue location in separate workflow |
| Community action secondary | One small display card; details/registration on phone |
| Too much text/buttons discourages attention | Dominant short story, four clear zones, large headings and focusable controls |

The six genuine participant summary is the research basis. Four coding-practice transcripts are excluded. Palette decisions are visual/accessibility judgements, not interview-derived preferences. No unspecified literature citations are invented.

## Accessibility and removed features

Touch controls meet at least 44 CSS pixels; keyboard focus uses outline, shadow and text. Macro navigation uses only Back/Choose/Next, with no separate Previous hardware button. The on-screen previous-story action remains reachable by cycling. Forms have visible labels, required fields, inline registration errors and preserved input on errors; status feedback is announced. Text alternatives accompany narration. Reduced motion disables automatic rotation. Responsive mobile and display layouts were checked; physical reach and outdoor glare remain hardware checks.

Statistics, exact pins, separate quiz/sounds/family/story pages, language switching, share codes, mandatory identity and AI advice are absent from the new primary flow. Legacy display URLs redirect; legacy Fencepost functionality remains at its routes rather than deleting dependent data or generated schemas.

## Known limitations and external prerequisites

- No Supabase project credentials were provided. PostgreSQL migration/RLS/RPC tests passed using disposable PostgreSQL with Supabase auth/storage shims, not the hosted Auth/Storage service. Hosted login, signed media URLs, cross-origin polling and production deployment must still be validated.
- Official wildlife sites were blocked by the cloud proxy. Facts have source fields, but editorial verification is pending. Unverified contacts are not displayed; the moderator can add reviewed contacts with source/date. This is not a verified emergency service.
- All six species and community scenes now have locally hosted original illustrations, with provenance and labels in IMAGE-ATTRIBUTIONS.md. The existing licensed brushtail photograph retains attribution; no image is presented as evidence of a real sighting or event.
- No copyrighted animal sounds were added. The allowed responsible-response activity is used instead. Narration relies on browser Web Speech; hardware/voices may vary.
- Videos become a single still; full-video playback/storage is intentionally not offered. Raw media originals are not retained.
- Registrations remain local demonstration records on all modes; no real event date, verified organiser or booking is supplied.
- Moderator opportunity editing covers the current single activity, not a large volunteer dashboard. Community Updates accept an optional human-reviewed image and a next-opportunity ID only when that event passes verification checks.
- A public rollout still needs real reviewer identity, privacy/retention policy, spam controls and hardware testing. These do not prevent an explicitly fictional local demonstration but do prevent a claim of production readiness.

## Screenshots and testing checklist

[Ten browser screenshots](docs/screenshots/README.md) show the actual public display and mobile flows. [TESTING.md](TESTING.md) records executed checks separately from hardware, official-source and hosted-service checks still required.

## Superseding interaction revision

REVISION.md records the current contract: Back moves to the previous option, Return links are selectable, stories rotate only after idle and never during a full-story read, species have mixed mini-quizzes including keyboard pick/place habitat planning, and Fencepost has a clear featured-story/guidance/feed/community hierarchy. The ten new screenshots replace the earlier design captures.

## Accounts and comment correction

ACCOUNTS-AND-WRITING.md supersedes the earlier ordinary-comment approval description. The two hardcoded exhibition accounts provide safe metadata sessions, owner-filtered profiles and moderator-only tools. Comments now use visible/removed status, with own-author edits/deletions and separate report review; only observation posts await publication approval. Ask AI writing help reuses the main-branch writer service and comparison flow, returns wording only, and requires explicit application as a draft.
