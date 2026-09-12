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
| `DASHSCOPE_API_KEY` | yes | Model access. Must be an **international (Singapore) console** key: the endpoint is `dashscope-intl.aliyuncs.com` and mainland keys are refused there. |
| `FENCEPOST_TOKEN_SECRET` | yes | Signs the request tokens. Any long random string; `python -c "import secrets; print(secrets.token_hex(32))"` will do. |
| `FENCEPOST_OPEN_SIGNUP` | no | Opens `POST /api/session`. Leave it unset anywhere real: with it on, anyone holding a handle can impersonate its owner. |
| `FENCEPOST_DB` | no | SQLite path. Defaults to `fencepost.db` in the repo, or `/tmp` when running on Vercel. |
| `CHAT_MODEL`, `SCREENER_MODEL`, `MODEL_TIMEOUT` | no | Model overrides. Defaults are in `proxy/model.py`. |
| `LIMIT_CHAT_PER_DAY`, `LIMIT_VISION_PER_HOUR`, `LIMIT_SUBMISSION_PER_HOUR` | no | Rate limits. Defaults match the operations doc. |

## Tests

None of them touch the network — the model is faked.

```bash
python tests/test_proxy.py && python tests/test_data_layer.py && python tests/test_entrypoint.py && python tests/test_resources.py
```

128 tests. The data layer ones matter most: they pin the three access invariants — other people's
entries never enter the assistant's context, a soft-deleted entry disappears on the next call, and
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
| `POST /api/storyboards` | Create a storyboard and grant its owner access. |
| `POST /api/storyboards/close` | Close a storyboard with a note. Archiving is not deletion: the QR still works. |
| `POST /api/videos` | Register a clip. Only a storage key is kept — there is no field for EXIF to land in. |
| `POST /api/entries` | Submit an entry. Screened first, created only if nothing was rejected. Needs `contribute` or `reshare`. |
| `POST /api/entries/edit` | Change your own entry. Changed fields go back through the Screener; a rejected edit leaves the original alone. |
| `POST /api/entries/delete` | Soft delete your own entry. The assistant stops seeing it on the next call. |
| `POST /api/share-links` | Issue a permissioned link. The plain token comes back once; only its hash is stored. |
| `POST /api/share-links/redeem` | Turn a token into a grant. Upgrades only — a view link never demotes anyone. |
| `POST /api/share-links/revoke` | Turn a link off. |
| `POST /api/grants/revoke` | Take someone's access away. Effective on the next call, with no cache in between. |
| `GET /api/timeline?storyboard_id=` | Every contributor's entries. Deliberately a different query from what the assistant sees. |
| `GET /api/dashboard` | The storyboards you can reach, active ones separated from past ones. |
| `POST /api/assistant` | Dispatch to one of the three model roles by `role`. Add `"stream": true` for server-sent events, which only the chat role supports. |

Every response carries `prompt_version`, which belongs in the database next to whatever the call
produced. Errors are fixed copy: upstream text, prompt content and the key never leave the server.

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

```bash
vercel deploy
```

Set `DASHSCOPE_API_KEY` and `FENCEPOST_TOKEN_SECRET` in the Vercel project first, with
`vercel env add`. Two things to know: new projects have deployment protection on, so a plain
request gets Vercel's own 401 rather than ours (`vercel curl` carries your session through), and
SQLite on Vercel only survives in `/tmp`, per instance, until the next cold start. It runs; it
does not persist.
