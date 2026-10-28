# Deploying Fencepost

## Environment variables

Locally these go in a `.env` in the repository root (it is git-ignored). On Vercel, add them
with `vercel env add`.

| Variable | Needed | What it does |
|---|---|---|
| `MODEL_PROVIDER` | no | `dashscope` (default in code) or `openai`. It picks the key, endpoint, default model and Screener effort together, from `PROVIDERS` in `proxy/model.py`. An unknown name is refused. Production has run `openai` since 2026-10-04. Switching provider means re-running `tests/run_redline.py` and `tests/run_nonenglish.py`. |
| `OPENAI_API_KEY` | with `openai` | Default model `gpt-6-luna`, endpoint `https://api.openai.com/v1` (`OPENAI_BASE_URL` overrides it). The Screener runs at `medium` effort on this provider. Set a monthly budget on the OpenAI project, because open sign-up means anyone with the URL can spend it. |
| `DASHSCOPE_API_KEY` | with `dashscope` | The fallback provider. The key only works against the gateway it was issued for, so it has to be set together with `DASHSCOPE_BASE_URL`. A mismatched pair gives a 401 that looks like a bad key. |
| `DASHSCOPE_BASE_URL` | with a Token Plan key | Defaults to `dashscope-intl.aliyuncs.com/compatible-mode/v1`. A Token Plan key needs `https://token-plan.<region>.maas.aliyuncs.com/compatible-mode/v1`, with the region of the account. Keep the `/compatible-mode/v1` suffix, the bare host returns 404. A request with no key returns 401 if the path exists and 404 if it does not, which is a free way to test a URL. |
| `FENCEPOST_TOKEN_SECRET` | yes | Signs tokens. Any long random string, for example from `python -c "import secrets; print(secrets.token_hex(32))"`. Changing it signs everybody out. |
| `FENCEPOST_OPEN_SIGNUP` | for `hybrid` | Opens `POST /api/session`, which is how the front end gets a token in `hybrid` and `live` mode. Leave it off anywhere with real users, since anyone holding a handle can act as its owner. The course deployment turns it on deliberately, so its database only holds demo data. People can still only read storyboards they have been given access to. |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | on Vercel | The hosted libSQL database. `vercel integration add turso` sets both. |
| `FENCEPOST_DB` | no | A local SQLite path or a `libsql://` URL. It takes priority over `TURSO_DATABASE_URL`. Defaults to `fencepost.db` locally and `/tmp` on Vercel, which is not a real option (see below). |
| `FENCEPOST_ALLOWED_ORIGIN` | on Vercel | Comma-separated origins allowed to call the API. Defaults to `*` locally. On Vercel an empty value allows nothing and the front end loads blank, so list every alias the front end is served on. |
| `CHAT_MODEL`, `SCREENER_MODEL`, `MODEL_TIMEOUT` | no | Model overrides. Defaults are in `proxy/model.py`. |
| `LIMIT_CHAT_PER_DAY`, `LIMIT_VISION_PER_HOUR`, `LIMIT_SUBMISSION_PER_HOUR` | no | Per-user rate limits. Defaults are in `proxy/ports.py`. |
| `LIMIT_MODEL_CALLS_PER_DAY` | no | Model calls across all users, retries included, over a rolling 24 hours. Default `1000`. Open sign-up gives every new handle a fresh per-user quota, so this is the limit that actually caps spending. Hitting it looks like an outage: the Screener lets posts through, the Writer is skipped and the assistant says it is offline. |
| `LIMIT_SESSIONS_PER_HOUR` | no | New identities `POST /api/session` creates per client address per hour. Default `120`, high on purpose because a lecture theatre can share one campus address. Exchanging an existing handle is not counted. Addresses are kept only as a keyed hash. |
| `LIMIT_PASSWORD_PER_15MIN` | no | Register and login attempts per client address per 15 minutes. Default `30`, because scrypt is expensive and a login for an unknown handle has no account to count against. `LIMIT_LOGIN_PER_15MIN` (default `10`) is the per-account limit on top. |

## Two Vercel projects

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

## Order of deploys

When a change touches both sides, push first. The front end is written to cope with an older
API, so it can rebuild while the API is still the old version. `check_deploy.py` will report
the API as out of date at that point if the change added a route. Then deploy the API and run
the check again. Doing it the other way round puts the new API in front of the old front end
for as long as the web build takes.

## First deploy of the API

Before the first `vercel deploy`, add the model key (`OPENAI_API_KEY` with
`MODEL_PROVIDER=openai`, or `DASHSCOPE_API_KEY`) and `FENCEPOST_TOKEN_SECRET`. New projects
have deployment protection on, so a plain request gets Vercel's 401 rather than ours;
`vercel curl` sends your session along. The API also needs the Turso database. Do not fall back
to SQLite on Vercel: it lives in `/tmp` on each instance and is lost on the next cold start,
which gives one handle two user ids and makes storyboards the dashboard just listed return 403.
