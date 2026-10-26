# Wildlife Neighbours park preview

This branch adds the public, anonymous park experience at `/` and `/park`, preserving the original storyboard dashboard at `/legacy`. Original `/b`, `/s`, `/c`, `/you`, `/sign-in`, `/credits`, `/study` and unrelated API functionality remain. The retired writing-suggestion service and its prompt are removed; the root schema is unchanged and no legacy records were made public.

The small Next client wrapper `web/components/ParkExperience.js` mounts shared park modules from `web/public/wildlife/`. A route-aware shell bypasses NameGate only for the public home and park entry. The static same-origin companion is `/wildlife/fencepost/index.html`; the same-origin display is `/wildlife/index.html`. Browser-local demo state is shared between those routes. It is not shared with a different origin or device.

The canonical shared implementation and Supabase schema live on the `design-preview` branch of `XinyueChang12138/wildlife-neighbours-display`. From that checkout, run `node scripts/sync-fencepost.mjs /path/to/this/checkout` after shared changes. Review/commit the generated public files. Integration uses the existing Next/React build and does not replace the Python/Turso storyboard service.

## Run and deploy

In `web/`: `npm ci`, then `npm run dev`, or `npm run build` followed by `npm start`. Google Fonts are locally bundled (same Figtree/Caprasimo families, OFL notices in `web/app/fonts/`). Existing storyboard frontend tests are retained; tests specifically for the old dashboard import the preserved LegacyHome component.

Default mode: clearly labelled fictional browser-only demo. No real personal or rescue details. The two hardcoded exhibition accounts give resident/moderator interface roles; their client-side authentication is not production security.

Connected mode: configure `NEXT_PUBLIC_WN_SUPABASE_URL`, `NEXT_PUBLIC_WN_SUPABASE_ANON_KEY` (legacy public anon JWT only) and optionally `NEXT_PUBLIC_WN_FENCEPOST_URL` in Vercel preview settings. `web/scripts/configure-wildlife.mjs` applies them at build time and rejects recognised service-role/secret keys. Both display and phone sites must use the same configured Supabase project. Provision the isolated schema, sample seeds, Storage buckets and moderator Auth role using the display repository's README. Existing `NEXT_PUBLIC_FENCEPOST_*` variables still apply to legacy routes only.

Deploy this branch as a Vercel preview with `web/` as Root Directory. Do not deploy over production without review. The park form works independently of the legacy Python API. Deploy the updated Python API as well if retiring its previously deployed writing endpoint. Current production URLs are not claimed to contain the preview.

## Functional paths

Stories → detail → immediate signed-in comments with reporting; Learn → species → activity; Share → text-only/optional-media observation → preview → Sent for review; private rescue route with no dispatch claim; moderator → privacy checklist → approval/rejection/clarification/urgent/removal → public story; Community → sample activity → prototype register-interest → view/edit/cancel/restore; moderator → publish Community Update. Keyboard/macro controls are on the display only. All new public browsing is anonymous.

## Limits

Hosted Supabase Auth/Storage and multi-device operation are unverified until configured. Registrations intentionally stay in localStorage even in connected mode and are never sent to a real organiser. Contacts and reference facts require official editorial verification; unverified contacts are suppressed. Original locally hosted illustrations cover six species and community care, with source/terms records and explicit prototype labels. No permanent cameras, instant public posting, unmoderated comments or model-generated wildlife advice are introduced. Source and privacy review remain human responsibilities.

## Latest interaction and visual revision

The public park home now introduces its purpose, one featured story, practical guidance, recent observations, optional activities and Community Updates. Four sample activities retain the complete prototype registration flow; four explicitly fictional updates link to their related activities. Species have mixed mini-quizzes and a keyboard-accessible habitat game. The display uses Back/Choose/Next for previous-option/activate/next-option, with selectable Return links. Apply the additive 003_exhibition_updates.sql migration for existing backends, then the updated seed file. See the canonical display branch REVISION.md and its ten screenshots for acceptance evidence.

## Demo accounts, direct comments and manual observations

At `/login` (or `/park#login`), quick-fill Taylor (resident@fencepost.demo / resident123) or Wildlife Moderator (moderator@fencepost.demo / moderator123), then select Sign in. Guests still browse and can submit anonymous observations. Session storage for demo users contains only safe identity/role metadata, never passwords. Moderator settings includes a confirmed reset of fictional demo data.

Observation posts require review; ordinary signed-in comments publish immediately after validation. Authors can reply/edit/delete, and others can report. Reported Comments is a separate moderator view with dismissal, reasoned removal and restoration. Apply wildlife-backend/004_accounts_direct_comments.sql before using the connected implementation; demo credentials never confer Supabase privileges.


The observation form uses manual text and optional media: preview, edit/cancel, then send for human review. Existing connected installations apply wildlife-backend/005_manual_observations.sql after migration 004.

The remaining server model settings and OpenAI SDK are shared by the unrelated legacy storyboard chat, frame identification and screening paths. They are still required; the park observation form uses none of them. Image-generation credits describe the existing artwork’s provenance and are retained. QR/code generation and general data-writing utilities are unrelated to observation authoring.
