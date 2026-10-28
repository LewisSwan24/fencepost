# Fencepost API

Everything goes through one entry point, `api/index.py`, which routes by path. Vercel's Python
builder takes a single entrypoint from `pyproject.toml`, so a new endpoint is added as a new
route in that file.

## Endpoints

| Path | What it does |
|---|---|
| `POST /api/session` | Swap a handle for a token, creating the user the first time. Only works when `FENCEPOST_OPEN_SIGNUP` is set. |
| `POST /api/register`, `POST /api/login` | Create or sign in to an account with a password. |
| `POST /api/sessions/revoke` | Sign out every token the account holds, including the current one. There is no session table, so it cannot sign out a single device. Accounts only: a guest's handle is public, so a guest gets 403 `not_an_account`. |
| `POST /api/storyboards` | Create a storyboard and give the owner access. The title is screened first. |
| `POST /api/storyboards/close` | Close a storyboard with a note. The note is screened. A closed storyboard is archived, not deleted, and its QR code still works. |
| `POST /api/videos` | Register a clip. Only a storage key is stored, so there is nowhere for EXIF data to go. |
| `POST /api/entries` | Post a sighting. Needs `contribute` or `reshare`. It is screened first and only created if nothing was rejected. |
| `POST /api/entries/edit` | Edit your own post. Changed fields are screened again; a rejected edit keeps the original. |
| `POST /api/entries/delete` | Delete your own post (soft delete). The assistant stops seeing it on the next call. |
| `POST /api/entries/remove` | A storyboard owner removes someone else's post. The database records who removed it. |
| `POST /api/share-links` | Make a share link, with `"short_code": true` for a three-word code. The plain token is returned once and only its hash is kept. `expires_in_days` is 1 to 90 (default 7), or 1 to 7 with a short code (default 1). |
| `GET /api/share-links?storyboard_id=` | The codes a storyboard has issued, revoked ones included. Needs `reshare`. Never returns a token. |
| `POST /api/share-links/redeem` | Turn a token or short code into access. It only ever upgrades: a view link never lowers anyone's level. |
| `POST /api/share-links/revoke` | Turn a link off. |
| `GET /api/grants?storyboard_id=` | Who has access and at what level. Needs `reshare`. |
| `POST /api/grants/revoke` | Remove someone's access. Takes effect on the next call, with no cache. |
| `GET /api/timeline?storyboard_id=[&after=]` | All posts on a storyboard, twenty per page. This is a separate query from what the assistant sees. Each post carries a base64 image and Vercel caps responses at 4.5 MB, so it has to be paged (the numbers are next to `TIMELINE_PAGE`). `after` is the previous page's `next`, a post id rather than an offset, so a new post cannot shift the pages. An unknown cursor gets a 400. The sighting count, participants and first-seen date are counted over all posts, not just the page. |
| `GET /api/forum?storyboard_id=` | Discussion threads on a storyboard. Reading needs any access, posting needs `contribute`. |
| `POST /api/forum/threads` | Start a thread. The text is screened first. |
| `POST /api/forum/posts` | Reply to a thread, screened the same way. |
| `POST /api/forum/posts/delete` | Delete your own reply. |
| `POST /api/forum/posts/remove` | A storyboard owner removes someone else's reply. |
| `GET /api/forum/thread?thread_id=[&after=]` | A thread's replies, oldest first, thirty per page (`FORUM_PAGE`), with the same cursor rules as the timeline. `next` is null on the last page. |
| `GET /api/review?storyboard_id=` | Posts flagged for checking. Never shows your own, so authors are not told they were flagged. |
| `POST /api/review/vote` | One vote per person, which can be changed. Two matching votes decide it. |
| `POST /api/review/dispose` | The owner keeps, labels or removes a flagged post. Removing is a soft delete. |
| `GET /api/dashboard` | The storyboards you can access, split into active and past. |
| `GET /api/record` | Your own record of what you have posted. There is no version of this for other people. |
| `POST /api/assistant` | Call one of the three model roles, chosen by `role`. Add `"stream": true` for server-sent events (chat only). |

## Responses and errors

Every response includes `prompt_version`, which is stored alongside whatever the call produced.
Error messages are fixed text, so model output, prompt content and keys never reach the client.

## Tokens

A token looks like `<user_id>.<issued_at>.<signature>` and lasts 30 days (`TOKEN_TTL_SECONDS`).
The signed part starts with `v2|`, so if the API is ever rolled back to a build from before
tokens had an expiry, it rejects new tokens instead of misreading them. Changing
`FENCEPOST_TOKEN_SECRET` signs everybody out; `POST /api/sessions/revoke` signs out one account.
