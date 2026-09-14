# fencepost-web

The Fencepost interface. Its own Vercel project, deployed separately from the API one: the
front end never calls DashScope directly, everything goes through the proxy, and the reasons
are in CLAUDE.md at the repository root.

The design came out of a Claude Design prototype (verified under issue #22). This is a
reimplementation rather than a port: the design-system tokens came across, the scattered hex
values did not.

## Running it

```
npm install
npm run dev
```

Configuration goes in `.env.local`:

```
NEXT_PUBLIC_FENCEPOST_API=http://127.0.0.1:8802
NEXT_PUBLIC_FENCEPOST_MODE=hybrid
```

The backend that goes with it:

```
FENCEPOST_OPEN_SIGNUP=1 FENCEPOST_ALLOWED_ORIGIN=http://localhost:3000 \
  python ../scripts/serve_local.py --port 8802
```

## Three modes

| `NEXT_PUBLIC_FENCEPOST_MODE` | CRUD | Assistant |
|---|---|---|
| `hybrid` (default) | real backend | fixture |
| `fixtures` | fixture | fixture |
| `live` | real backend | real model |

The demo runs `hybrid`, and **that is what is live**:

| | Address |
|---|---|
| Front end | https://fencepost-app.vercel.app |
| API | https://fencepost-api.vercel.app |

The two Vercel generated aliases (`fencepost-web-ten` and `fencepost-omega`) cannot be removed
and still work, but the pair above is what gets handed out. The front-end one is first in the
API's CORS allow-list.

The red lines govern **the assistant**: a real model can say something that crosses one, and in
the room there is no second chance (CLAUDE.md). The CRUD half carries no such risk, and hiding
it would be a waste.

`hybrid` and `live` both have to exchange a token at `/api/session`, and that endpoint is closed
unless the deployment has `FENCEPOST_OPEN_SIGNUP`. **That is a precondition of both modes, not
an option** — with it on, anybody can exchange any handle for a token. In the prototype, that
is the sign-in model.

**Settled on 2026-09-13: delivery stays on `hybrid` and the flag stays.** The reason is that
those are one decision, not two: remove the flag and `/api/session` closes, `hybrid` cannot get
a token, and the site opens blank. Removing it would mean switching back to `fixtures` at the
same time, which would hide the real-backend half that has already measured 12/12.

The cost is stated rather than buried: anybody visiting this site can exchange any handle for a
token, and can then create storyboards, post entries and post in the forum. So the live database
holds **demo data only** — never write a real person or a real address into it.

**Each visitor has an identity of their own (changed 2026-09-14).** With
`NEXT_PUBLIC_FENCEPOST_HANDLE` unset, `lib/api.js` generates a `guest_xxxxxx` per browser and
keeps it in localStorage, so somebody coming back is still themselves. Set it and it wins —
that is for local development and tests.

This has been changed twice, both times for the same class of fault, which is worth remembering:

1. The default used to be `mel_k`, who is the **owner** of the demo storyboard. Anyone who
   forgot to configure the variable handed every visitor the ability to archive, revoke access
   and delete other people's entries. The default is empty now: the fallback is "a stranger
   with their own name", not "everyone is the owner".
2. It was then fixed to `visitor`, which the owner layer did stop — but **every visitor shared
   one identity**, so `author_id` was equal between them and visitor A could edit and delete
   what visitor B wrote.

A new identity has access to no storyboard at all, so there has to be a **join code**:
`NEXT_PUBLIC_FENCEPOST_JOIN_TOKEN` holds a share link to the demo storyboard, redeemed once
automatically after a token is obtained. Holding the plaintext in the front end exposes nothing
new — open sign-up already lets anyone exchange any handle for a token, and the code reaches one
storyboard holding demo data.

**The level it carries is the whole thing, and getting it wrong is silent.** The first code
granted `contribute`. The Share button asks for `reshare`. So every visitor arrived one level
below the permissioned QR code this product is about, the share screen was reachable by nobody
on any storyboard a visitor could see, and typing the address went straight back to the
storyboard because the screen stops people the server would refuse. Nothing failed and nothing
was logged. A button was not drawn. Reported as "the share page has disappeared" on 2026-09-15,
which is exactly what it looks like from outside.

**What is remembered is the code, not the fact of having joined.** It used to store `"1"`,
answering "has this browser ever joined?", and that is the wrong question: the moment a
replacement code is issued, every visitor who had already joined skips it for good and stays on
whatever the old one gave them. Keyed on the code, a new code is redeemed exactly once more by
everybody, including the people carrying the old `"1"`, and an unchanged one is still never
redeemed twice. Six tests in `api.test.mjs`.

**It expires.** The server enforces 1 to 90 days; a permanent one cannot be issued. The current
code runs until **2026-12-13**, after which a new visitor cannot redeem and opens to an empty
dashboard (existing visitors are unaffected, their grant is already in the database).

Issuing one is `scripts/issue_join_code.py`, which did not exist until the level was wrong and
there turned out to be no written-down way to make another. It lists what the owner can reach,
refuses to issue without being told which storyboard, defaults to `reshare`, and then **redeems
the code once as somebody else and checks what that person actually received** before saying it
worked. The token is written to a file and never printed, so it stays out of scrollback and
transcripts; the command it prints for `vercel env add` reads that file. The redeploy afterwards
is not optional, because `NEXT_PUBLIC_` values are compiled into the bundle.

A token by itself grants very little: visibility still follows `access_grants`, and a storyboard
nobody shared with you will not open — the timeline answers 403 `no_access` and the assistant
never receives that context. Those two are pinned by `test_the_timeline_needs_a_grant` and
`test_someone_elses_storyboard_stays_out_of_reach`. So what open sign-up widens is how much can
be written, not whose content can be seen.

To finish, run `scripts/teardown_demo.py`. When it has cleared the database it reminds you the
flag is still on, and that removing it empties the front end at the same moment. Do not reverse
the order: close the entrance first, then clear, or the site is still open when you finish and
the next visitor grows a fresh set of data.

The backend is on hosted Turso (`TURSO_DATABASE_URL`), so data survives across requests, across
instances and across cold starts. That was not always true: the database used to live in
Vercel's `/tmp`, one copy per instance, so one handle became two different users and a storyboard
the home page listed answered 403 when opened. The account is in `qwen-integration.md` §6.

## Images

`public/frames/` holds four CC BY-SA 4.0 photographs from Wikimedia Commons, three taken in
Brisbane and one a real night shot. **They are not the users' photographs** — in the real
product that position holds a still from the filmer's own video. `/credits` says so in its first
paragraph, because the statement belongs next to the photographs rather than in a README.

`lib/frames.js` matches an image to a species and derives a stable index from the entry id, so a
refresh does not change the picture. A species of `other` or `unknown` gets none: dropping any
possum in would assert on the user's behalf what they filmed, and "visual identification must
never set the species" is one of this project's red lines. The cover on a list card comes from
`latest_species` in `/api/dashboard`, ordered to match `timeline()` word for word.

Before anything enters the repository it is resized to 1200px and stripped of EXIF, GPS and
camera model:

```
magick raw.jpg -resize "1200x1200>" -strip -interlace Plane -quality 82 out.jpg
exiftool out.jpg          # only filesystem and JPEG structure fields should remain
```

That is a CLAUDE.md safety line and is not waived because the material came from a public site:
a photograph carries where it was taken, and this product is about not giving away where you
live. Replacing or adding an image means doing this step too, and adding the attribution and the
"changed or not" note to `lib/frames.js` and `/credits`.

## Tests

```
npm test
```

That is `node --test "lib/*.test.mjs"`. The pattern is quoted because cmd.exe does not expand
globs, and it matches `*.test.mjs` rather than the directory because `node --test lib/` would
treat the ordinary `.js` modules in there as test files. A new test file is picked up without
anything being edited, which the previous hand-written list of four filenames was not.

`fixtures.test.mjs` pins the assistant's routing table: one case per demo script, plus several
that once went to the wrong branch ("Will it hurt my cat?" belongs with injured rather than
"possums are all I know about", and "Do they eat fruit?" should answer diet rather than turning
into a line about not feeding them).

`format.test.mjs` pins that **looking forward and looking back are different things**.
`relative()` only counts backwards and answers "today" for any future time, while the share
screen has to show a code's expiry — a code that expires on 30 October read "Expires today",
which is enough to make somebody revoke a perfectly good code and issue another. Found running
fixtures locally on 2026-09-14.

`copy.test.mjs` pins **the sentence an author reads when they are stopped**. It is copied from
`ux-copy.md` §1, and that document is not in the repository, so nothing automatic can notice a
copying mistake — this file is the trace left by doing the comparison by hand. On 2026-09-14 it
turned up three mismatches: two codes the Screener never sends were configured, five it really
does send were missing, and the fallback sentence had been written separately.

`classnames.test.mjs` is the same idea in a second namespace. `ui` and `styles` are CSS-module
objects, so `ui.btnn` is `undefined`, React renders `className={undefined}` as no class at all,
and what you get is a control that works perfectly with none of its styling: no error, no
warning, nothing in the console. There are over 400 such references across one stylesheet per
screen, which is more than anyone re-checks after a rename. The test also checks its own
assumption, that `ui` is still `components/ui.module.css`, because if that export were rewired
every other assertion would be reading the wrong stylesheet and would go on passing.

`mask.test.mjs` covers the one place a safety line is enforced in code rather than written on
a screen. `lib/mask.js` decides whether a face or a number plate is covered enough to send the
frame; it used to sit inside the mask screen, where the suite could not reach it, while that
screen's own header called it a hard requirement. The threshold is pinned at exactly 0.78 so a
box that is precisely good enough is not refused with nothing on screen to say why, and two
boxes that between them cover a target still do not count, which is deliberate: the gate asks
for more than it needs rather than less.

One mutation there is worth recording because it is not a test gap. Dropping either
`Math.max(0, ...)` overlap clamp on its own changes nothing at all, since the other clamp
already zeroes the product; measured, both give identical results on every case. Dropping both
makes a box diagonally away from a target score 9 rather than 0, and a face nowhere near the
box reads as covered. Two tests catch that.

`frames.test.mjs` pins **the two promises attached to the placeholder photographs**. The first
is a red line: visual identification never sets the species, and this module is where that is
actually drawn in the interface, so an entry whose species is `other` or `unknown` gets no
picture at all. A helpful-looking fallback would break the line silently, with a plausible
possum on screen and nothing to notice. The second is the licence condition above. The credits
page maps over `FRAMES`, so it can never miss an image; what it can do is keep saying "all
four" and "three were taken in daylight" after a fifth is added, and go on claiming CC BY-SA
for every one of them after something else slips in. Each mutation was checked: dropping the
species filter, collapsing the hash so a third of the pictures are never chosen, renaming a
file, and emptying an author field each fail exactly the test meant to catch them.

## Checked in a browser

Some things the suite cannot reach, because they are React behaviour or focus behaviour and
the tests run without a DOM. These were measured against `npm run dev` on 2026-09-15 by
dispatching real pointer and keyboard events at the page, not by clicking through by hand:
the preview pane scales an emulated viewport, so coordinates written by eye land somewhere
else, and an earlier attempt to drag a mask box failed for that reason rather than because
anything was wrong with the page. Computing the coordinates inside the page from
`getBoundingClientRect()` removes that whole class of false finding.

**The mask screen, and why dev mode is where it showed.** One drag left two identical boxes
stacked exactly on top of each other, so the remove button looked broken: the first click
took one away and the copy underneath was still sitting in the same place. Releasing a drag
had been reaching the box through a `setLive` updater and calling `setBoxes` from inside it,
and React invokes updaters twice under StrictMode precisely to make that show. React said so
itself in the console, `Cannot update a component (DraftProvider) while rendering a different
component (Mask)`. There is no `next.config`, so strict mode is on by default and anybody who
clones this meets it at once; the production build does not double invoke, which is why
walking the deployment by hand never turned it up. With `reactStrictMode: false` and nothing
else changed, one drag gave one box, which is what identifies the mechanism rather than
guessing at it. After the fix, with strict mode back on: one drag, one box; a twitchy tap
still refused; remove works on the first click; covering both targets still enables Next.

**The consent sheet.** `aria-modal="true"` is a statement to a screen reader that everything
outside the dialog is not there, and it is only true if Tab is actually trapped. Verified on
the same run: the dialog carries `aria-modal` and an `aria-labelledby` that points at a
heading that exists, focus moves into the dialog on open, Tab from the last control wraps to
the first and Shift+Tab from the first wraps to the last, Escape closes it, and focus returns
to the button that opened it rather than being dropped on the body.

**The rest of the screens.** Every route was loaded and the console read: no errors and no
warnings beyond React's own DevTools notice. `/b/[id]/add/write` correctly bounces to the
species step when the draft has no species, which is the guard doing its job.

## Layout

```
app/
  page.js                    1 · My storyboards
  b/[id]/page.js             9 · Storyboard detail (timeline, review label, discussion, drawer)
  b/[id]/add/                the posting flow, one route per step
    DraftContext.js          where the draft lives across routes
    page.js                  2 · Capture
    frame/                   3 · Pick a frame
    mask/                    4 · Mask + 5 · the consent sheet
    species/                 6 · Which one is it?
    write/                   7 · Write it up
    blocked/                 8b · Stopped
  b/[id]/close/              the owner closing it: four consequences and a closing line (user-flow §9)
  b/[id]/review/             the second-look queue and the owner's disposal (operations §2)
  b/[id]/forum/              11 · Discussion (list and thread detail)
  b/[id]/share/              12 · Share: QR placeholder, three levels, expiry, codes issued, who has access
  s/[token]/                 13 · Scanning a code lands here, then into the storyboard
  no-access/                 14 · The link does not work
app/credits/                 image credits (a CC BY-SA condition, so it lives in the app)
components/ui.js             the shared shell and controls
components/Shot.js           one frame: picture, night grading, dark wash
components/Chat.js           10 · The Possum Help conversation
components/QrPlaceholder.js  a placeholder graphic, not a real code
lib/api.js                   the client for all three modes
lib/fixtures.js              assistant responses and the offline dataset
lib/copy.js                  user-facing copy, defined in one place
lib/format.js                displaying times and handles
lib/frames.js                the four images, their attribution, and the rule for matching them
lib/mask.js                  whether a face or a plate is covered enough to send the frame
```

## Places the interface narrows to the server's rules, rather than pretending to

- No vote buttons on your own entry (the server answers `not_your_call` to an author)
- None for somebody holding `view` either (the server answers `read_only_access`, because
  reviewing is between contributors)
- Revoke appears only for the owner (`revoke_grant` answers `not_the_owner`)
- An archived storyboard has no way in to posting
- Closing appears only for the owner (`close_storyboard` answers `not_the_owner`), and not at
  all once archived
- The new-thread button and the reply box are not drawn for `view` or for an archived
  storyboard (`read_only_access` / `storyboard_closed`)
- Edit and delete appear only on your own entries (`not_your_entry`), and go once archived
  (`storyboard_closed`)
- The second-look entry point does not appear for `view` (`read_only_access`) — but **it is
  still given on an archived storyboard**: none of those three endpoints consults the status,
  and hiding it would be lying in the other direction
- "Turn this code off" appears only on codes you issued, or if you are the owner (`created_by`
  or owner, **not** reshare)

Every one of these is "the server would refuse, so the interface does not offer the button",
rather than "the interface hides it and pretends it is not there". The difference is that the
first one still holds when somebody goes around the interface.

## The no-access state

`/no-access` fetches nothing and draws no distinction between a link that expired and one that
was revoked. Drawing that distinction would turn a dead link into a probe: try another token,
and the difference in wording tells you that storyboard exists.
