# Exhibition accounts, immediate comments and manual observations

These requirements supersede the previous pre-approval workflow for ordinary comments. Wildlife observation posts and their optional media still require human review before publication.

## Demonstration accounts and central storage

| Account | Email | Public demonstration password | Role |
| --- | --- | --- | --- |
| Taylor | resident@fencepost.demo | resident123 | user |
| Wildlife Moderator | moderator@fencepost.demo | moderator123 | moderator |

`shared/demo-accounts.js` is the single, clearly labelled credential configuration. These credentials are deliberately public exhibition fixtures, not real secrets. Hardcoded authentication is used only for the Fencepost exhibition prototype. Client-side credentials and route protection are not secure enough for a deployed production service. Never enter real passwords, private addresses or sensitive information in this local demo.

The `#login` page has email/password fields, show/hide password, inline errors, a credentials panel, guest continuation and quick-fill buttons. Quick-fill never signs in automatically. `shared/auth.js` validates the selected account and writes only `{id, displayName, email, role}` to `wn-demo-session`. No password is saved in localStorage. Refresh restores the session; logout clears it and clears in-memory form/media state. Invalid session shapes are treated as signed out. Role-aware routes redirect to login or an access-denied view before private UI or queue data is rendered.

`shared/storage.js` is the central persistence service. Observations, published stories, reports, comment actions, registrations, receipts and favourites share the `wn-demo-v2` data store. Registration and observation projections are filtered to the current account. Browser data from the previous version is migrated additively; old anonymous registrations/receipts retain guest ownership, and old pre-approval comments remain removed rather than being silently published.

Taylor has a pending and an approved observation, a saved approved story and one prototype registration. Other users’ pending/rejected content, rescue locations and moderator notes are excluded from the resident projection. The moderator has separate sections for posts, welfare reports, comments, reported comments, activities, updates, sources, history and settings. Settings contains the only reset control; confirmation restores the full fictional seed set while preserving account configuration and the active moderator session.

## Current routes

Both static and Next park experiences support `#login`, `#profile`, `#my-observations`, `#moderator`, `#moderator/pending`, `#moderator/urgent`, `#moderator/approved`, `#moderator/rejected`, `#moderator/comments`, `#moderator/reports`, `#moderator/opportunities`, `#moderator/updates`, `#moderator/sources`, `#moderator/history`, `#moderator/settings`. Existing public story/learning/share/help/community routes remain.

Next also supplies `/login`, `/stories`, `/learn`, `/help`, `/community`, `/profile`, `/my-observations`, `/moderator` and `/moderator/[section]` aliases which redirect into `/park` at the corresponding hash. These are client-side exhibition role guards, not server security boundaries. Legacy `/sign-in`, `/legacy`, `/b/...` and unrelated Python/Turso services remain separate.

## Posts versus comments

**Posts:** create → preview → Sent for review → human privacy/media/species/wording checks → approve/reject → public story. A pending post is never returned by the public projection. A signed-in author can see only their own limited status/text projection; anonymous text-only submission still works. Moderator actions record identity, action, reason and time.

**Comments:** a signed-in resident or moderator writes/replies → immediate validation → visible immediately. Guests read but must sign in to participate. There is no ordinary-comment pending/approval state. Authors can edit or delete their own visible comments; they cannot edit others. Author-deleted comments cannot be restored by a moderator. Moderator removals can be restored.

`shared/comment-safety.js` rejects empty/oversized text and recognisable addresses, coordinates, contact details, plates, dangerous instructions and threats. Less certain issues show a caution and allow revision or explicit acknowledgement. The UI says automated checks are imperfect; reporting and human review remain necessary. Validation is not a guarantee of location/person detection, and it does not substitute for production abuse controls.

Every other person’s comment offers Report with the six requested reasons and optional details. A report stays open and leaves the comment visible until a moderator removes it. Reported Comments is separate from Posts awaiting approval. The moderator can inspect the linked story, dismiss a report, remove with a reason or restore a moderator removal. Report status records reviewer/time; a separate comment-action log preserves remove/restore/dismiss actions. Comments are never labelled reviewed or approved merely because they are visible.

## Manual observation form and storage

Visitors write their own text, optionally attach media, preview the public version and edit or cancel before sending. Submission produces a Sent for review receipt. Nothing is published until a moderator approves it. The form does not require a model, provider key or assistance service.

The local-data upgrade removes retired suggestion drafts and assistance flags while preserving observations, comments, reports, registrations, receipts, favourites and the account session. Existing Supabase deployments apply `005_manual_observations.sql` after `004_accounts_direct_comments.sql`; it preserves author ownership and comment permissions while dropping the obsolete metadata column. Fresh installations use the updated fourth migration followed by the fifth migration as well.

The hardcoded accounts apply only to local demonstration data and never confer Supabase privileges. Connected mode requires real Supabase Auth and moderator membership. Auth tokens remain in the existing sessionStorage binding. No fake backend accounts are created.

## Validation

Node and browser checks cover authentication, role boundaries, own-observation projections, direct comments, reports, moderator actions, data preservation and manual submissions. Manual journeys cover text-only input, optional photographs, preview, edit, cancellation and Sent for review. The current checks pass 21 static tests, 515 frontend tests and the Python suite (493 pass, one existing documentation check skipped). The static display and copied Next application build and pass Chromium journeys; see TESTING.md for details. Hosted Supabase connectivity and the physical exhibition equipment still require installation testing.
