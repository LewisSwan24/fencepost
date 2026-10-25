# Exhibition accounts, immediate comments and contextual writing help

These requirements supersede the previous pre-approval workflow for ordinary comments. Wildlife observation posts and their optional media still require human review before publication.

## Demonstration accounts and central storage

| Account | Email | Public demonstration password | Role |
| --- | --- | --- | --- |
| Taylor | resident@fencepost.demo | resident123 | user |
| Wildlife Moderator | moderator@fencepost.demo | moderator123 | moderator |

`shared/demo-accounts.js` is the single, clearly labelled credential configuration. These credentials are deliberately public exhibition fixtures, not real secrets. Hardcoded authentication is used only for the Fencepost exhibition prototype. Client-side credentials and route protection are not secure enough for a deployed production service. Never enter real passwords, private addresses or sensitive information in this local demo.

The `#login` page has email/password fields, show/hide password, inline errors, a credentials panel, guest continuation and quick-fill buttons. Quick-fill never signs in automatically. `shared/auth.js` validates the selected account and writes only `{id, displayName, email, role}` to `wn-demo-session`. No password is saved in localStorage. Refresh restores the session; logout clears it and clears in-memory form/media state. Invalid session shapes are treated as signed out. Role-aware routes redirect to login or an access-denied view before private UI or queue data is rendered.

`shared/storage.js` is the central persistence service. Observations, published stories, reports, comment actions, registrations, receipts, favourites and writing drafts share the `wn-demo-v2` data store. Registration and observation projections are filtered to the current account. Browser data from the previous version is migrated additively; old anonymous registrations/receipts retain guest ownership, and old pre-approval comments remain removed rather than being silently published.

Taylor has a pending and an approved observation, a saved approved story, one prototype registration and an AI-assisted unsubmitted draft. Other users’ pending/rejected content, rescue locations and moderator notes are excluded from the resident projection. The moderator has separate sections for posts, welfare reports, comments, reported comments, activities, updates, sources, history and settings. Settings contains the only reset control; confirmation restores the full fictional seed set while preserving account configuration and the active moderator session.

## Current routes

Both static and Next park experiences support `#login`, `#profile`, `#my-observations`, `#moderator`, `#moderator/pending`, `#moderator/urgent`, `#moderator/approved`, `#moderator/rejected`, `#moderator/comments`, `#moderator/reports`, `#moderator/opportunities`, `#moderator/updates`, `#moderator/sources`, `#moderator/history`, `#moderator/settings`. Existing public story/learning/share/help/community routes remain.

Next also supplies `/login`, `/stories`, `/learn`, `/help`, `/community`, `/profile`, `/my-observations`, `/moderator` and `/moderator/[section]` aliases which redirect into `/park` at the corresponding hash. These are client-side exhibition role guards, not server security boundaries. Legacy `/sign-in`, `/legacy`, `/b/...` and Python/Turso services remain separate and intact.

## Posts versus comments

**Posts:** create → preview → Sent for review → human privacy/media/species/wording checks → approve/reject → public story. A pending post is never returned by the public projection. A signed-in author can see only their own limited status/text projection; anonymous text-only submission still works. Moderator actions record identity, action, reason and time.

**Comments:** a signed-in resident or moderator writes/replies → immediate validation → visible immediately. Guests read but must sign in to participate. There is no ordinary-comment pending/approval state. Authors can edit or delete their own visible comments; they cannot edit others. Author-deleted comments cannot be restored by a moderator. Moderator removals can be restored.

`shared/comment-safety.js` rejects empty/oversized text and recognisable addresses, coordinates, contact details, plates, dangerous instructions and threats. Less certain issues show a caution and allow revision or explicit acknowledgement. The UI says automated checks are imperfect; reporting and human review remain necessary. Validation is not a guarantee of location/person detection, and it does not substitute for production abuse controls.

Every other person’s comment offers Report with the six requested reasons and optional details. A report stays open and leaves the comment visible until a moderator removes it. Reported Comments is separate from Posts awaiting approval. The moderator can inspect the linked story, dismiss a report, remove with a reason or restore a moderator removal. Report status records reviewer/time; a separate comment-action log preserves remove/restore/dismiss actions. Comments are never labelled reviewed or approved merely because they are visible.

## Ask AI Help port from main

Source inspected safely without switching/resetting branches: `LewisSwan24/fencepost` main commit `3f2e1b0f96e6369d8ee4916d9651b728b66b6864`.

| Existing main file | Reuse/adaptation |
| --- | --- |
| `web/app/b/[id]/add/write/page.js` | Original-versus-tidied comparison and explicit application interaction adapted into the current observation form |
| `web/lib/api.js` → `writerHelp()` | Reused by `web/lib/wildlife-writing.js`; optional AbortSignal is threaded to the existing request path |
| `web/lib/fixtures.js` → `tidy()` / writer fixture | Tidying logic copied (formatting adapted) to `shared/writer-port.js`; existing Next writer fixture is still called; small labelled editorial variants wrap the same tidied text |
| `web/app/b/[id]/add/write/write.module.css`, shared Sheet/Spinner patterns | Inspected for comparison/loading/focus behaviour; presentation adapted to the current park CSS rather than copying old colours |
| `proxy/app.py` writer endpoint, `proxy/roles.py` writer validator, `prompts/writer.txt`, `proxy/model.py` | Inspected and retained; no generated prompt or Python/Turso schema was overwritten |
| Existing `web/components/Chat.js` | Inspected as the conversational feature; contextual writing uses the existing writer role, not a new generic chatbot |

The Next `ParkExperience` component injects the existing writer adapter into the shared mobile mount. `writerHelp('unknown', description)` avoids species/fact candidates; the adapter returns only `tidied_story`, dropping `fun_facts` and model questions. The browser preflight rejects identifying text before any request. No uploaded media, exact rescue-location field, condition report or post ID is sent. Output is screened conservatively for unsupported details and loss of uncertainty; unusable suggestions fail safely. These checks cannot certify perfect AI faithfulness, so the user must review all wording.

The form has Ask AI for writing help beside the description. Original and suggested text are separate. Consent precedes the request; the suggestion is editable, and the final-wording confirmation is required before Use suggestion. Try another, Keep original, Cancel and Undo remain available. Applying a suggestion changes only the draft; preview and submission still require their own actions, and human moderation is unchanged. User edits to a suggestion are allowed. Cancellation aborts the browser request where supported and suppresses late responses. Service failure leaves the original text and manual posting usable.

## Dependencies and configuration

No new runtime package or AI key is introduced. Static mode uses a labelled prewritten local writing fallback. Next reuses the original `NEXT_PUBLIC_FENCEPOST_MODE` and `NEXT_PUBLIC_FENCEPOST_API`: fixtures/hybrid use the existing fixture writer; live explicitly uses the existing Python API's writer service. Provider keys and `FENCEPOST_TOKEN_SECRET` stay only in that server project's environment. Never put model keys in NEXT_PUBLIC variables or shared config. Existing backend setup documentation still applies.

The hardcoded accounts apply only to local demonstration data. They never confer Supabase privileges. A connected deployment uses real Supabase Auth identities and the moderator membership table; residents have their own signed-in Auth identity. Auth tokens remain in the existing sessionStorage binding, not in the hardcoded user metadata. Apply `supabase/004_accounts_direct_comments.sql` after the earlier migrations before enabling connected comments/profiles. It attaches author IDs server-side, provides safe own-observation projections, replaces old comment RPC access, enforces immediate authenticated comments with ownership checks, and records private report/moderation actions. Anonymous comment writes and arbitrary table mutation are denied. No fake Supabase users/passwords are seeded.

## Verification

- Node account/data tests exercise safe session storage, role separation, private projections, pending-post isolation, immediate comments, ownership, reports, removal/restoration/dismissal, reset, writing preflight and cancellation.
- Browser account journeys exercise both logins, wrong credentials, quick-fill without auto-login, refresh/logout, profile restrictions, direct comment edit/delete/report, writer compare/edit/apply/undo, manual submission and moderator actions.
- A failure-injected writer browser test verifies manual posting remains usable; cancelled and identifying requests do not change the draft.
- PostgreSQL RPC/RLS tests verify guest denial, authenticated immediate publication, own-only edits, private-profile projection, report-without-hiding, moderator remove/restore/audit and author deletion.
- All 527 Next tests and the production build passed, including three adapter tests proving existing fixture writer reuse, cancellation and distinct retry wording. A built-app browser check also passed login aliases, the existing fixture writer, retry without draft mutation and the resident moderator-route guard.

Real model-provider connectivity and hosted Supabase services are not configured in this cloud session. Local fixture/browser behaviour and PostgreSQL test shims are verified separately from those hosted integrations. The cardboard iPad/physical controls still require the previously documented hardware check.
