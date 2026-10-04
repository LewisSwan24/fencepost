# Fencepost

The server side of Fencepost: residents in Brisbane film a possum, write up what they saw, and
build a shared storyboard that reaches other people through a permissioned QR code. This
repository holds the proxy that talks to the model, the data layer behind it, and the tests. The
interface lives elsewhere.

The design documents — product flow, the prompt source, the data model, operations and UX copy —
are deliberately **not** in this repository. Everything here runs and deploys without them. What
you cannot do without them is regenerate `prompts/*.txt` and `schema.sql`.

## Requirements

Python 3.12 or newer.

```bash
pip install -r requirements.txt
```

## Environment

Create a `.env` in the repository root. It is git-ignored.

| Variable | Required | What it does |
|---|---|---|
| `DASHSCOPE_API_KEY` | with `MODEL_PROVIDER=dashscope` (the default) | Model access. **The key and `DASHSCOPE_BASE_URL` are a pair** — a key is valid against one gateway and refused by the others, so changing one without the other produces a 401 that reads like a bad key. The deployment currently uses a Token Plan key (`sk-sp-…`) against `token-plan.ap-southeast-1.maas.aliyuncs.com`; an ordinary international console key goes with `dashscope-intl.aliyuncs.com`. Mainland and international are not interchangeable in either direction — measured 2026-09-17: an international Token Plan key is refused by `cn-beijing` and by both `dashscope` hosts. |
| `DASHSCOPE_BASE_URL` | with a Token Plan key | The OpenAI-compatible root. Defaults to `dashscope-intl.aliyuncs.com/compatible-mode/v1` (`proxy/model.py`), which is **not** where a Token Plan key works — that needs `https://token-plan.<region>.maas.aliyuncs.com/compatible-mode/v1`, with the region following the account rather than the Bailian docs' `cn-beijing` default. The `/compatible-mode/v1` suffix is required; the bare host answers 404. To find the right one without spending a call, POST to a candidate with no key at all: 401 means the path exists, 404 means it does not. |
| `FENCEPOST_TOKEN_SECRET` | yes | Signs the request tokens. Any long random string; `python -c "import secrets; print(secrets.token_hex(32))"` will do. A token is `<user_id>.<issued_at>.<signature>` and lasts 30 days (`TOKEN_TTL_SECONDS`). Rotating this signs out **everybody** at once, which is the blunt instrument; `POST /api/sessions/revoke` is the per-person one. |
| `FENCEPOST_OPEN_SIGNUP` | no | Opens `POST /api/session`. Leave it unset anywhere real: with it on, anyone holding a handle can impersonate its owner. **The course deployment sets it deliberately** — it is this prototype's entire login model, and the `hybrid` frontend cannot obtain a token without it, so removing it blanks the site. It widens who can *write*, not who can *read*: visibility still runs through `access_grants`. Reasoning in `web/README.md`. |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | on Vercel | The hosted libSQL database. `vercel integration add turso` injects both. Required for any real deployment — see Deploying. |
| `FENCEPOST_DB` | no | Database address, and it wins over `TURSO_DATABASE_URL`. A local SQLite path, or a `libsql://` URL to point a script at the hosted database. Defaults to `fencepost.db` in the repo, or `/tmp` on Vercel — and `/tmp` is a last resort, not a deployment. |
| `FENCEPOST_ALLOWED_ORIGIN` | on Vercel | Origins allowed to call the API from a browser, comma-separated. Off Vercel it defaults to `*`. On Vercel an unset value fails closed: no origin is allowed, so the frontend loads blank, and `scripts/check_deploy.py` fails on it. List **every** alias the frontend answers on, because a missing one loads blank with nothing but a CORS error to go on. |
| `MODEL_PROVIDER` | no | `dashscope` (default) or `openai`. Picks the key variable, endpoint and default model as one row (`PROVIDERS` in `proxy/model.py`); an unknown name is refused rather than defaulted. Switching changes the model the red lines were measured on, so re-run `tests/run_redline.py` and `tests/run_nonenglish.py` first (#50). |
| `OPENAI_API_KEY` | with `MODEL_PROVIDER=openai` | Used only by the `openai` row; the DashScope key is never sent there, nor this one to DashScope. Default model `gpt-6-luna`, endpoint `https://api.openai.com/v1` (`OPENAI_BASE_URL` overrides). Set a monthly budget on the OpenAI project — open signup means anyone with the URL spends it. |
| `CHAT_MODEL`, `SCREENER_MODEL`, `MODEL_TIMEOUT` | no | Model overrides. Defaults are in `proxy/model.py`. |
| `LIMIT_CHAT_PER_DAY`, `LIMIT_VISION_PER_HOUR`, `LIMIT_SUBMISSION_PER_HOUR` | no | Rate limits. Defaults match the operations doc. |
| `LIMIT_MODEL_CALLS_PER_DAY` | no | Ceiling on model calls across **everybody**, retries included, over a sliding 24 hours. Default `1000`. Open sign-up makes a fresh handle a fresh per-user quota, so this is what actually bounds spend. Reaching it looks like an outage: the Screener fails open, the Writer skips, the assistant says it is offline. |
| `LIMIT_SESSIONS_PER_HOUR` | no | New identities `POST /api/session` will create per client address per hour. A handle that already exists is exchanged without counting: a guest's browser exchanges its handle again on every page load. Default `120`, generous on purpose — a lecture theatre can sit behind one campus NAT. The address is counted as a keyed hash, never stored. |
| `LIMIT_PASSWORD_PER_15MIN` | no | Password work `POST /api/register` and `POST /api/login` will do per client address per 15 minutes. scrypt is memory-hard, and register (which also writes a row) and a login for a handle nobody holds run it with no per-user counter to bill, so this bounds the unauthenticated flood. Default `30`, keyed hash, same NAT caveat as sessions. `LIMIT_LOGIN_PER_15MIN` (default `10`) is the tighter per-account cap that stays on top of it. |

## Tests

None of them touch the network — the model is faked.

```bash
python tests/test_proxy.py && python tests/test_data_layer.py &&
python tests/test_entrypoint.py && python tests/test_resources.py &&
python tests/test_store.py && python tests/test_teardown.py &&
python tests/test_batch_reports.py
```

431 tests. Two files have gone missing from that line since it was written. The last
two until 2026-09-17, so thirty-one were never run by the documented command; then
`test_batch_reports.py`, added on 2026-09-20 and left out the same day — and that one
was worse, because it also had no `unittest.main()`, so running it by name printed
nothing and exited 0. Adding a suite means adding it here. The data layer ones
matter most: they pin the three access invariants — other people's entries never
enter the assistant's context, a soft-deleted entry disappears on the next call, and
a revoked grant stops both context and chat history immediately.

## Generated files, and why they are committed

`prompts/*.txt` and `schema.sql` are generated from the design documents. Since those documents
are not in the repository, the generated files have to be, or a clone could neither prompt the
model nor create its database.

**Do not edit them by hand.** With the documents present:

```bash
python scripts/build_prompts.py && python scripts/build_schema.py
```

A test compares `schema.sql` against the document when the document is available, and skips when
it is not.

## Endpoints

One entry point, `api/index.py`, routing by path. The Vercel Python builder resolves a single
entrypoint from `pyproject.toml`, so a new endpoint is a new route, never a new file.

| Path | What it does |
|---|---|
| `POST /api/session` | Exchange a handle for a token, creating the user on first use. Off unless `FENCEPOST_OPEN_SIGNUP` is set. |
| `POST /api/sessions/revoke` | Sign out: refuse every token this person holds, the one making the call included. All of them, not one device — there is no session table to be selective with. **Accounts only**: a guest's handle is public and exchanges for a token under open sign-up, so anybody could otherwise sign a guest out, in a loop; a guest gets 403 `not_an_account`, and loses nothing by it. |
| `POST /api/storyboards` | Create a storyboard and grant its owner access. The title is screened; a refusal creates nothing. |
| `POST /api/storyboards/close` | Close a storyboard with a note. The note is screened, and a refused one leaves it open. Archiving is not deletion: the QR still works. |
| `POST /api/videos` | Register a clip. Only a storage key is kept — there is no field for EXIF to land in. |
| `POST /api/entries` | Submit an entry. Screened first, created only if nothing was rejected. Needs `contribute` or `reshare`. |
| `POST /api/entries/edit` | Change your own entry. Changed fields go back through the Screener; a rejected edit leaves the original alone. |
| `POST /api/entries/delete` | Soft delete your own entry. The assistant stops seeing it on the next call. |
| `POST /api/share-links` | Issue a permissioned link. The plain token comes back once; only its hash is stored. Lasts `expires_in_days` (1–90), seven if unstated — reasoning above `SHARE_LINK_DAYS`. |
| `GET /api/share-links?storyboard_id=` | The codes this storyboard has issued, revoked ones included so a revoke is visibly done. Needs `reshare`. Never returns a token — only the hash is stored, so it could not. |
| `POST /api/share-links/redeem` | Turn a token into a grant. Upgrades only — a view link never demotes anyone. |
| `POST /api/share-links/revoke` | Turn a link off. |
| `POST /api/grants/revoke` | Take someone's access away. Effective on the next call, with no cache in between. |
| `GET /api/timeline?storyboard_id=[&after=]` | Every contributor's entries, twenty at a time. Deliberately a different query from what the assistant sees. Paged because each entry carries a base64 frame and an unbounded list crosses the platform's 4.5 MB response cap, where the answer is a 413 rather than a slow page — arithmetic in `TIMELINE_PAGE`. `after` is the previous page's `next` (an entry id, not an offset, so a sighting posted mid-scroll cannot shift the window); a cursor this storyboard never issued is a 400, not a silent restart. `sightings`, `participants` and `first_seen` are counted over every live entry, because the header states all three and one page cannot answer them. |
| `POST /api/forum/threads` | Start a thread. The body is screened first; a rejection creates nothing. |
| `POST /api/forum/posts` | Reply to a thread, screened the same way. |
| `GET /api/forum?storyboard_id=` | Threads on a storyboard. Reading needs any grant, posting needs `contribute`. |
| `GET /api/forum/thread?thread_id=[&after=]` | A thread's replies, oldest first, thirty at a time (`FORUM_PAGE`): a reply runs to the free-text cap, so an unbounded thread crosses the same 4.5 MB response cap the timeline did. `after` is the previous page's `next` (a post id), and `next` is null on the last page; a cursor this thread never issued is a 400. |
| `GET /api/review?storyboard_id=` | Entries flagged for checking. Never includes your own — the author is not told. |
| `POST /api/review/vote` | One vote per person, changeable. Two agreeing votes settle it. |
| `POST /api/review/dispose` | The owner keeps, labels or removes. Removal is a soft delete. |
| `GET /api/dashboard` | The storyboards you can reach, active ones separated from past ones. |
| `POST /api/assistant` | Dispatch to one of the three model roles by `role`. Add `"stream": true` for server-sent events, which only the chat role supports. |

Every response carries `prompt_version`, which belongs in the database next to whatever the call
produced. Errors are fixed copy: upstream text, prompt content and the key never leave the server.

**Tokens expire, and deploying the change that gave them an expiry signs everyone out once.**
Before 2026-09-18 a token was `<user_id>.<signature>`: deterministic, so one string per person
for ever, with no issue time to expire and nothing but rotating the secret to revoke. Old
two-part tokens are not accepted, so the first deploy of that change ends every existing
session. In a tab running the new front end, accounts see "Your sign-in has ended" and sign
in again; in a tab still on the old code, an account sees the assistant's "Sign in again" line
once and its next action runs as the guest until the page is reloaded - so deploy when nobody
is signed in, or ask account holders to reload. Guests are re-issued a token
against the same handle without noticing — **but only in a tab running the new front end**. A
tab opened before `fencepost-web` rebuilt still runs the old code, which shows one error and
recovers on the next click. Deploy order narrows that window; nothing closes it for a tab that
stays open across both deploys. Reasoning in `docs/data-model.md` §1.2.

**The signed material carries a version tag, `v2|`,** so an API rolled back to a build from
before that change refuses new tokens outright instead of reading them as phantom user ids.

## Running it locally

```bash
python scripts/serve_local.py --port 8787
```

That is the same handler Vercel runs. To check the model connection and whether the chat model
accepts image input:

```bash
python scripts/smoke.py
```

## Red-line tests

29 cases covering the safety rules, 10 of them asserted automatically and the rest printed for a
human to judge. Needs a key and spends real tokens.

```bash
python tests/run_redline.py
```

Run it after any prompt change and keep the report.

## Deploying

**Two projects, one repository, two different triggers.** This is the thing to hold in your
head before touching anything at the repo root.

| project | what it serves | how it deploys |
|---|---|---|
| `fencepost` | the Python API, `fencepost-api.vercel.app` | `vercel deploy --prod` from this directory |
| `fencepost-web` | the front end, `fencepost-app.vercel.app` | automatically, on every push to `main` |

So a `git push` rebuilds the front end and does **nothing** to the API, and a `vercel deploy`
does the opposite. Neither one tells you anything about the other.

**A root-level build file affects both.** `.vercelignore` is read for both projects, and
`fencepost-web` has `web/` as its Root Directory. On 2026-09-17 a `web/` entry was added to
`.vercelignore` to trim the Python bundle; it deleted the front end's source instead. Next.js
found no app directory, emitted a single 404 page through the pages router, and Vercel
deployed that and reported **Ready**. Every route on the site answered 404 for about an hour
while the dashboard showed green.

Two things came out of that, and they are why this section is longer than the command:

- **Trimming the API bundle does not belong in `.vercelignore`.** It lives in `vercel.json`
  under `functions["api/index.py"].excludeFiles`, which is scoped to that one function and
  cannot reach another project's build. `.vercelignore` now holds only what nobody may ever
  upload: `.env*`, `*.db`, and the two files carrying plaintext share tokens.
- **After any deploy, and after any change to a root build file, run the check.** A few
  seconds, no credentials, writes nothing:

  ```bash
  python scripts/check_deploy.py
  ```

  It loads real pages on the front end and every route on the API, and exits non-zero if
  either is not serving. A green deployment status cannot tell you whether what got deployed
  is what you meant to deploy; this can. It is not `scripts/verify_deployment.py`, which walks
  ten authenticated chains and leaves a `verify-*` user in the production database each run.

**Order, when a change touches both sides:** push first, so `fencepost-web` rebuilds against
an API that is still the old one — the front end is written to tolerate that. Then run
`check_deploy.py`: after a change that adds a route it reports the API as stale, which is what
it should say at that point. Then deploy the API and run the check again. The other order puts
the new API in front of old front-end code for as long as the web build takes.

```bash
vercel deploy
```

Set the model key (`OPENAI_API_KEY` with `MODEL_PROVIDER=openai`, as production runs since 2026-10-04,
or `DASHSCOPE_API_KEY`) and `FENCEPOST_TOKEN_SECRET` in the Vercel project first, with
`vercel env add`. Two things to know: new projects have deployment protection on, so a plain
request gets Vercel's own 401 rather than ours (`vercel curl` carries your session through), and
the API needs a hosted database. `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` come from
`vercel integration add turso`. Do not fall back to SQLite on Vercel: it only survives in `/tmp`,
per instance, until the next cold start, which gives one handle two user ids and makes the
storyboard the dashboard just listed return 403. It runs; it does not persist.
