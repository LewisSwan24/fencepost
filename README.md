# Fencepost

Fencepost is our DECO7285 (2026) project for the theme Care. Residents in Brisbane film possums
on their own phones and post what they saw, with a fun fact and what happened that night. The
posts build up into a storyboard that several neighbours keep adding to. A storyboard is shared
through a QR code that carries a permission level, never a public link, and each storyboard has
its own discussion thread.

The built-in assistant, Possum Help, only knows about brushtail and ringtail possums, only sees
the content of the person asking, and cannot write anything.

| Folder | What it is |
|---|---|
| `api/`, `proxy/` | The Python API: sign-in tokens, rate limits, the three model roles, the database layer |
| `web/` | The Next.js front end, with its own [README](web/README.md) |
| `hardware/share-tag/` | Firmware for the share tag (see below) |

## How the demo runs

The deployed site runs in `hybrid` mode. Storyboards, posts and sharing go through the real
API, but Possum Help answers from pre-written replies, because a live model could break one of
our safety rules in front of the markers. The server still screens posts with the model.

A few features worth knowing about:

- Short codes. Besides the QR code, the Share screen can give three words like
  `wattle-moon-gum` for a neighbour to type in. They last a day by default and a week at most.
- The share tag. An M5StickS3 that shows one short code when someone presses its button. It
  has no network and no sensors. We treat it as an exhibit for the tradeshow: a code only
  appears when a person is there and chooses to show it.
- Study mode. During user testing, `/study` keeps the questions Possum Help could not answer,
  on that device only, until the facilitator exports them.

## Running it

Python 3.12 or newer:

```bash
pip install -r requirements.txt
python scripts/serve_local.py --port 8787
```

Put at least `FENCEPOST_TOKEN_SECRET` and a model key in a `.env` in the repository root. The
full list of variables is in [DEPLOYING.md](DEPLOYING.md). To check the model connection, run
`python scripts/smoke.py`.

## Tests

The Python tests never use the network. Run them on Python 3.12, since the libsql client some
of them import is not available for 3.14 yet:

```bash
py -3.12 -m unittest discover tests
```

Read the `OK` or `FAILED` line at the end. The front end tests run with `npm test` in `web/`.

After changing a prompt or switching model provider, run `python tests/run_redline.py` (29
safety cases) and `python tests/run_nonenglish.py` (70 cases). Both use a real key and cost
real tokens.

## Generated files

`prompts/*.txt` and `schema.sql` are generated from design documents that are kept outside
this repository, so they are committed. Do not edit them by hand; with the documents present,
`python scripts/build_prompts.py && python scripts/build_schema.py` regenerates them.

## More

- [API.md](API.md): every endpoint, and how tokens work
- [DEPLOYING.md](DEPLOYING.md): environment variables, the two Vercel projects, and
  `scripts/check_deploy.py`, which you run after every deploy
