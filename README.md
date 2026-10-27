# Fencepost

Fencepost is our DECO7285 (2026) project for the theme Care. Residents in Brisbane film possums
on their own phones and post what they saw, with a fun fact and what happened that night. The
posts build up into a storyboard that several neighbours keep adding to. A storyboard is shared
through a QR code that carries a permission level, never a public link, and each storyboard has
its own discussion thread.

The app has a built-in assistant called Possum Help. It only knows about brushtail and ringtail
possums, it only sees the content of the person asking, and it cannot write anything.

This repository holds three parts:

| Folder | What it is |
|---|---|
| `api/`, `proxy/` | The Python API: sign-in tokens, rate limits, the three model roles, the database layer |
| `web/` | The Next.js front end. It has its own README, [web/README.md](web/README.md) |
| `hardware/share-tag/` | Firmware for the share tag, an M5StickS3 that shows a short share code |

The design documents (product flow, prompt source, data model, operations, UX copy) are kept
outside the repository. Everything here runs and deploys without them. The only thing you need
them for is regenerating `prompts/*.txt` and `schema.sql`.

## How the demo runs

The front end has three modes, set with `NEXT_PUBLIC_FENCEPOST_MODE`:

| Mode | Storyboards, posts, sharing | Possum Help |
|---|---|---|
| `hybrid` (default, and what is deployed) | real API | pre-written replies |
| `fixtures` | pre-written data | pre-written replies |
| `live` | real API | real model |

We present in `hybrid`. Everything you create is real and goes through the API, but Possum
Help answers from pre-written replies in `web/lib/fixtures.js`. A live model could say
something that breaks one of our safety rules in front of the markers, and there is no second
attempt. The server still screens posts with the model in this mode.

`hybrid` needs `FENCEPOST_OPEN_SIGNUP` on the API, because that is how a browser gets a token.
With it on, anyone can swap any handle for a token, so the deployed database only ever holds
demo data. People can still only read storyboards they have been given access to.

## Features worth knowing about

Share codes. The Share screen makes a QR code with a permission level and an expiry of 1, 7,
30 or 90 days (7 by default). The owner can also ask for a short code of three words, like
`wattle-moon-gum`, that a neighbour can type in instead of scanning. The words come from a
hand-picked list of just over a thousand in `proxy/words.py`. A short code is easier to guess
than a token, so it lasts one day by default and a week at most. Only hashes of codes are
stored.

The share tag. `hardware/share-tag/` is firmware for an M5StickS3 (it also builds for an
M5StickC PLUS). It holds one short code and shows it when someone presses the front button. It
never connects to Fencepost or any network and has no sensors. We treat it as an exhibit for
the tradeshow, not a tool: the point it makes is that a code only appears when a person is
standing there and chooses to show it. Its README covers building and flashing.

Study mode. During user testing, Possum Help runs from pre-written replies and normally keeps
no record. Study mode, started from `/study` in the browser, keeps the questions that got the
general fallback reply, word for word, so we can see what people actually asked. Questions that
matched a reply are only counted. Everything stays on that device until the facilitator exports
it from `/study`, and a participant can turn it off from the chat.

Accounts. A visitor gets a guest handle per browser. They can also register a handle with a
password, which gives them sign-out.

## Setup

Python 3.12 or newer.

```bash
pip install -r requirements.txt
```

Put a `.env` in the repository root (it is git-ignored):

| Variable | Needed | What it does |
|---|---|---|
| `MODEL_PROVIDER` | no | `dashscope` (default in code) or `openai`. It picks the key, endpoint, default model and Screener effort together, from `PROVIDERS` in `proxy/model.py`. An unknown name is refused. Production has run `openai` since 2026-10-04. |
| `OPENAI_API_KEY` | with `openai` | Default model `gpt-6-luna`, endpoint `https://api.openai.com/v1` (`OPENAI_BASE_URL` overrides it). The Screener runs at `medium` effort on this provider. Set a monthly budget on the OpenAI project, because open sign-up means anyone with the URL can spend it. |
| `DASHSCOPE_API_KEY` | with `dashscope` | The fallback provider. The key only works against the gateway it was issued for, so it has to be set together with `DASHSCOPE_BASE_URL`. A mismatched pair gives a 401 that looks like a bad key. |
| `DASHSCOPE_BASE_URL` | with a Token Plan key | Defaults to `dashscope-intl.aliyuncs.com/compatible-mode/v1`. A Token Plan key needs `https://token-plan.<region>.maas.aliyuncs.com/compatible-mode/v1`, with the region of the account. Keep the `/compatible-mode/v1` suffix, the bare host returns 404. A request with no key returns 401 if the path exists and 404 if it does not, which is a free way to test a URL. |
| `FENCEPOST_TOKEN_SECRET` | yes | Signs tokens. Any long random string, for example from `python -c "import secrets; print(secrets.token_hex(32))"`. Changing it signs everybody out. |
| `FENCEPOST_OPEN_SIGNUP` | for `hybrid` | Opens `POST /api/session`. Leave it off anywhere with real users, since anyone holding a handle can act as its owner. The course deployment turns it on deliberately (see above). |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | on Vercel | The hosted libSQL database. `vercel integration add turso` sets both. |
| `FENCEPOST_DB` | no | A local SQLite path or a `libsql://` URL. It takes priority over `TURSO_DATABASE_URL`. Defaults to `fencepost.db` locally and `/tmp` on Vercel, which is not a real option (see Deploying). |
| `FENCEPOST_ALLOWED_ORIGIN` | on Vercel | Comma-separated origins allowed to call the API. Defaults to `*` locally. On Vercel an empty value allows nothing and the front end loads blank, so list every alias the front end is served on. |
| `CHAT_MODEL`, `SCREENER_MODEL`, `MODEL_TIMEOUT` | no | Model overrides. Defaults are in `proxy/model.py`. |
| `LIMIT_CHAT_PER_DAY`, `LIMIT_VISION_PER_HOUR`, `LIMIT_SUBMISSION_PER_HOUR` | no | Per-user rate limits. Defaults are in `proxy/ports.py`. |
| `LIMIT_MODEL_CALLS_PER_DAY` | no | Model calls across all users, retries included, over a rolling 24 hours. Default `1000`. Open sign-up gives every new handle a fresh per-user quota, so this is the limit that actually caps spending. Hitting it looks like an outage: the Screener lets posts through, the Writer is skipped and the assistant says it is offline. |
| `LIMIT_SESSIONS_PER_HOUR` | no | New identities `POST /api/session` creates per client address per hour. Default `120`, high on purpose because a lecture theatre can share one campus address. Exchanging an existing handle is not counted. Addresses are kept only as a keyed hash. |
| `LIMIT_PASSWORD_PER_15MIN` | no | Register and login attempts per client address per 15 minutes. Default `30`, because scrypt is expensive and a login for an unknown handle has no account to count against. `LIMIT_LOGIN_PER_15MIN` (default `10`) is the per-account limit on top. |

## Running it locally

```bash
python scripts/serve_local.py --port 8787
```

This runs the same handler Vercel runs. To check the model connection, and that the chat model
accepts images:

```bash
python scripts/smoke.py
```

For the front end, see [web/README.md](web/README.md).

## Tests

The Python tests never use the network; the model is faked. Run them on Python 3.12, because
the libsql client some of them import is not available for 3.14 yet:

```bash
py -3.12 -m unittest discover tests
```

(`py` is the Windows launcher. Elsewhere use `python3.12`.) Read the `OK` or `FAILED` line at
the end. If you pipe the output through `grep` or `tail`, the pipeline can exit 0 even when
tests failed. The data layer tests are the important ones.
They hold the three access rules: other people's posts never reach the assistant, a deleted
post is gone on the next call, and a revoked grant cuts off both context and chat history
straight away.

The front end tests use Node's built-in test runner:

```bash
cd web
npm install
npm test
```

Two batch runs use a real key and cost real tokens. Run both after changing a prompt or
switching `MODEL_PROVIDER`, and keep the reports:

```bash
python tests/run_redline.py
python tests/run_nonenglish.py
```

`run_redline.py` has 29 safety cases; 10 are checked automatically and the rest are printed for
a person to judge. `run_nonenglish.py` has 70 cases checking that posts in other languages are
never rejected outright.

## Generated files

`prompts/*.txt` and `schema.sql` are generated from the design documents. The documents are not
in the repository, so the generated files have to be, or a fresh clone could not prompt the
model or create its database. Do not edit them by hand. With the documents present:

```bash
python scripts/build_prompts.py && python scripts/build_schema.py
```

A test compares `schema.sql` with the document when the document is available and skips
otherwise.

## Endpoints

Everything goes through one entry point, `api/index.py`, which routes by path. Vercel's Python
builder takes a single entrypoint from `pyproject.toml`, so a new endpoint is added as a new
route in that file.

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

Every response includes `prompt_version`, which is stored alongside whatever the call produced.
Error messages are fixed text, so model output, prompt content and keys never reach the client.

A token looks like `<user_id>.<issued_at>.<signature>` and lasts 30 days (`TOKEN_TTL_SECONDS`).
The signed part starts with `v2|`, so if the API is ever rolled back to a build from before
tokens had an expiry, it rejects new tokens instead of misreading them.

## Deploying

One repository builds two Vercel projects, and they deploy differently:

| Project | Serves | Deploys |
|---|---|---|
| `fencepost` | the Python API, `fencepost-api.vercel.app` | `vercel deploy --prod` from the repository root |
| `fencepost-web` | the front end, `fencepost-app.vercel.app` (Root Directory `web/`) | automatically on every push to `main` |

A `git push` rebuilds the front end and does nothing to the API, and `vercel deploy` does the
opposite.

Files at the repository root, such as `.vercelignore`, `vercel.json` and `pyproject.toml`, are
read by both projects. On 2026-09-17 we added `web/` to `.vercelignore` to make the Python
bundle smaller, and it removed the front end's source instead. The build still passed: Next.js
produced a single 404 page, Vercel marked it Ready, and every page on the site was a 404 for
about an hour. Because of that:

- Trimming the API bundle goes in `vercel.json` under
  `functions["api/index.py"].excludeFiles`, which only affects that one function.
  `.vercelignore` only lists files that should never be uploaded at all, like `.env*` and
  `*.db`.
- After every deploy, and after any change to a root build file, run:

  ```bash
  python scripts/check_deploy.py
  ```

  It takes a few seconds, needs no credentials and writes nothing. It loads real pages on the
  front end and every route on the API, and exits non-zero if either one is not serving what it
  should. It is different from `scripts/verify_deployment.py`, which signs in, walks ten full
  request chains and leaves a `verify-*` user in the production database each time.

When a change touches both sides, push first. The front end is written to cope with an older
API, so it can rebuild while the API is still the old version. `check_deploy.py` will report
the API as out of date at that point if the change added a route. Then deploy the API and run
the check again. Doing it the other way round puts the new API in front of the old front end
for as long as the web build takes.

Before the first `vercel deploy`, add the model key (`OPENAI_API_KEY` with
`MODEL_PROVIDER=openai`, or `DASHSCOPE_API_KEY`) and `FENCEPOST_TOKEN_SECRET` with
`vercel env add`. New projects have deployment protection on, so a plain request gets Vercel's
401 rather than ours; `vercel curl` sends your session along. The API also needs the Turso
database. Do not fall back to SQLite on Vercel: it lives in `/tmp` on each instance and is lost
on the next cold start, which gives one handle two user ids and makes storyboards the dashboard
just listed return 403.
