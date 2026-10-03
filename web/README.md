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

## The postcss override

`package.json` carries an `overrides` block forcing `postcss` to `^8.5.28`. It is there for
four advisories, and it should not be tidied away without reading this.

Next pins postcss exactly, and every 15.x release pins `8.4.31` — including the newest,
15.5.25, which is what the `backport` tag points at. Four advisories stand against that
version: an XSS through an unescaped `</style>` in stringify output, and three separate
path-traversal and information-disclosure bugs in source-map auto-loading, two of them high.
The last of the four is not fixed until `8.5.23`. npm's own fix offers exactly one route,
`next@16.3.5`, marked `isSemVerMajor` — the bump landed in Next 16.3.0, is not described in
those release notes as a security fix, and has not been backported to 15.x.

A framework major for a build-time dependency is the wrong trade two weeks out, and it is not
necessary. postcss is a plain hoisted dependency here, not one of the copies vendored into
`next/dist/compiled/`, so the build genuinely resolves `node_modules/postcss` and an override
genuinely changes what runs rather than only quieting the report. It moves one package;
nothing else in the lockfile changes except postcss's own declared ranges.

Checked rather than assumed, on 2026-09-20: 254 tests green, a clean `npm run build` listing
all nineteen routes, and `npm audit` at zero. The emitted CSS was compared block by block
between a build on 8.4.31 and one on 8.5.28 — 382 rule blocks each, the same set, every one
byte-identical. 209 of them sit at a different index, but that is Next's chunk ordering and
not postcss: two builds on the *same* postcss produce different orderings too, which is why
the content hash of the largest stylesheet is not a usable signal here. Class names are
module-hashed, so their order carries no cascade meaning.

Take the override out once Next 15 ships a postcss above 8.5.22, or once the project moves to
Next 16.

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

One command: `node --import ./test/setup.mjs --test "lib/*.test.mjs" "test/*.test.mjs"`.
Everything runs with a document, because everything here runs in a browser. `npm run
test:screens` is `test/` on its own when that is all you have touched. The patterns are quoted
because cmd.exe does not expand globs, and they match `*.test.mjs` rather than the directory
because `node --test lib/` would treat the ordinary `.js` modules in there as test files. A new
test file is picked up without anything being edited, which the previous hand-written list of
four filenames was not.

It was two commands for a day, and the reason is worth keeping. `lib/` used to be tested
without a document, and two tests in `stills.test.mjs` quietly depended on that: they handed
`stillsFrom` a plain object as a File, and both `extractStills` and `stillFromImage` return
`[]` at once when `typeof document === "undefined"`, so neither of the two paths those tests
are named for was ever entered. The file said as much in a comment, which is what made it a
known limit rather than a mistake — but the limit was the whole content of the test.

Fixing them (#39) took more than a real Blob. Measured on 2026-09-20, jsdom loads no media at
all: an `<img>` handed a blob URL fires neither `load` nor `error`, and a `<video>` neither
`loadedmetadata` nor `error`. So a real Blob on its own leaves the photograph path hanging for
good and the clip path hanging until `BUDGET_MS`, which is twelve seconds. Both elements are
stood in for instead, the same move `redact()` made when it took its drawing surface as a
parameter, and each stand-in reports the failure a browser reports for a blob it cannot
decode. The routing is then observable — the photograph path is the one that makes an image,
the clip path the one that makes a video — and both still answer `[]`, which is the contract
either way. Five mutations, including reading `file.mimeType` instead of `file.type`, which is
the rename that would send every phone photograph down the video decoder.

That asymmetry is recorded rather than fixed: `extractStills` gives up after twelve seconds
because "somebody looking at a spinner at a fence in the dark" is the failure it is written
against, and `stillFromImage` has no budget at all. A blob URL is local, so a real browser
always fires one of the two and there is no reachable hang — but the guard is on one path and
not the other.

`api.test.mjs` had the same shape of dependency, in the other direction. Its thirty-three
cases are all about the network paths and they read `NEXT_PUBLIC_FENCEPOST_MODE` from whatever
the process was carrying, which was nothing, so they got the default. The screen tests set it
to `fixtures` for the whole run and all thirty-three failed at once. `freshApi()` now deletes
it before each fresh import, next to the join token it already deleted for exactly this
reason.

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

### The screens

`test/` holds the render harness and one file per screen. `--import ./test/setup.mjs` registers
a module hook and puts a jsdom document in place before anything else loads, which is the whole
of the setup; a test then imports the page like any other module and renders it.

The hook exists because Next's bundler is what normally makes these files importable. It does
three things. It runs `web/**/*.{js,mjs}` outside `node_modules` through esbuild and returns
them as ES modules — the screens are full of JSX, and this package.json has no
`"type": "module"`, so Node would otherwise read them as CommonJS and stop at the first `<`. It
answers a `*.css` import with a `Proxy` that returns the key as the class name, so `styles.lede`
is `"lede"` and a class name is something a test can assert on; whether that name exists in the
stylesheet is `classnames.test.mjs`'s question, not this one. And it resolves `next/navigation`
and `next/font/google` to stubs in `test/stubs/`. Those three are the entire non-relative import
surface of `app/` and `components/`, apart from React itself. The font stub hands back the shape
`layout.js` destructures, with a class name of `font`, and downloads nothing.

The document is jsdom, and rendering goes through React 19, `@testing-library/react` and
`@testing-library/user-event`. `test/harness.mjs` covers what the real app supplies around a
screen: `params` arrive as a promise that is read with `use`, so a screen is always rendered
inside Suspense and awaited, and the five posting screens get a `DraftProvider` with an optional
`seed` so a test can open the species step already holding a suggestion. To run one file on its
own, from `web/`:

```
node --import ./test/setup.mjs --test test/forum.test.mjs
```

A browser API jsdom lacks (`getUserMedia`, canvas, `Image` decoding, `URL.createObjectURL`) is
stood in for inside the one suite that needs it, on `globalThis`, and put back afterwards. None
of that goes into the shared files.

The navigation stub records rather than navigates: `navigated` is the list of `["push", "/you"]`
pairs since `reset()`. "Signing in takes you to /you" is then a claim about that list, which is
checkable, rather than a claim about a real router inside jsdom, which would either do nothing
or unload the document. Doing this in the loader rather than with `node:test`'s `mock.module()`
is deliberate: module mocking is still behind `--experimental-test-module-mocks`, and a stub the
loader installs is the same stub for every importer, including one three levels down inside a
component.

The hook also retries a failed relative resolve with `.js` and then `/index.js`, because the
screens import each other the way a bundler allows — `from "../../lib/api"`, no extension — and
Node's resolver requires one. Only relative specifiers, and only after the real resolver has
already said no, so nothing there can shadow a package that does exist.

`sign-in.test.mjs` is the first. It holds rules that live in one expression in the middle of a
component and nowhere else: the submit button is disabled until the handle is three characters
and the password eight, the "there is no password reset" warning belongs to one of the two modes
only, and the password field's `autocomplete` has to be `new-password` when making an account
and `current-password` when signing in — two hints a password manager reads and a person cannot
see. Five mutations of the screen were checked and each failed the test meant to catch it,
including deleting the `<span>` that gives the handle field its accessible name: those inputs
are labelled by a `<label>` wrapping them rather than by `htmlFor`, and if that is ever broken
into siblings the field goes on working with a mouse and stops being announced at all.

Every route and every component now has a file: the eight first ones (`home`, `sign-in`,
`board`, `share`, `forum`, `close`, `add-species`, `add-mask`) and, under #38, `add`,
`add-frame`, `add-write`, `add-blocked`, `thread`, `review`, `you`, `share-link` (`s/[token]`),
`no-access`, `credits`, `chat`, `name-gate`, `camera`, `shot`, `qr-code`, `qr-placeholder` and
`ui`. They pin what a header comment, `copy.js` or CLAUDE.md says must happen rather than
markup: a refusal that comes back 200 with `published: false` is not reported as a post, Possum
Help stays a label with no avatar and no way to write, review never blocks and never tells the
author, and nobody is ranked. A bug a test turns up in a screen goes in as a `{ todo }` with the
reason, so the suite stays green and the bug stays visible, rather than being fixed in the same
pass.

**What the fixtures can and cannot put a screen into.** These tests drive the offline dataset,
so a rule can only be checked in the states that dataset can reach, and three cannot be reached
at all. No sighting of mine is under review, so neither half of "an author sees the review label
and not the two buttons" is testable. There is no read-only *open* storyboard — sb_roof is a view
grant and archived — so a view grant's lack of vote buttons cannot be told apart from the board
being closed, and neither can the two halves of the forum's "Start a thread" gate. And no
storyboard runs past one page of twenty, so "Show more sightings" is never drawn. Each gap is
named in the header of the file it belongs to, and the two that a mutation would slip through are
carried in the mutation set as deliberate misses rather than left out of it, so a run says so out
loud. Closing all three means adding to what the demo contains, which is a separate decision.

The #38 suites found more of the same kind. Each is also named at the top of its own file:

- **`add`.** Real video decoding (`extractStills`) needs a decoder and a canvas. The suite
  stubs `Image`, `URL.createObjectURL` and the canvas per test and covers only "one photograph
  still", "`[]`, undecodable" and "still decoding"; a multi-still clip from the library input is
  not driven end to end. Camera output (`takePhoto` / `stopVideo` into `fromCamera`) needs a
  live frame drawn to canvas, so only opening, closing and the refused-camera fallback are
  covered.
- **`add-write`.** `submitEntry` and `writerHelp` never throw offline, so the error line is
  unreachable. `helper.question` needs an empty tidied story while Post and the panel need a
  non-blank one, so it only appears for a whitespace-only story and is not asserted.
- **`thread`.** sb_roof is both view-only and archived, so which half of `canReply` hides the
  reply box and the take-down buttons cannot be told apart. Offline answers an empty thread
  rather than the server's 404 after the last post goes. `createPost` only publishes or
  refuses, so a reply held for `review` has nothing to render, and it always writes as mel_k,
  so other-author cases use the seeded t1/t2.
- **`review`.** The only queued entry (e3) is on sb_jacaranda, which I own, so a non-owner
  never looks at a non-empty queue and dropping the `owner` check fails nothing. None of my own
  sightings is under review. `castVote` and `disposeEntry` never throw, so rollback and the
  error line are unreachable. One queued entry means one disposal per process, spent on the
  labelled confirm path. The queue item carries no handle, so the test can only check that
  `aroha_t` and `@` never appear, and code that rendered `item.handle` would not be caught.
- **`you`.** "Sign-in has ended" (`session_ended`) never happens offline, and `lib/api`'s
  fixtures namespace cannot be replaced from a test.
- **`share-link`.** `lib/api` reads `MODE` once at module scope and the fixture only refuses
  with a 404, so unreachable / `session_ended`, which should keep the code on the page rather
  than going to `/no-access`, are untested. "Checking the code…" at 900 ms never shows, because
  the fixture resolves in the same tick.
- **`chat`.** There is no image path in Chat; frame consent lives in the add flow, so the suite
  pins only that Chat offers no attachment, video or canvas. Starting offline and the live
  branch are both read at module scope; the offline line is reached through the failure path.
- **`name-gate`.** `hasHandle()` never throws, so the "never block the app on this" catch is
  unreachable, and rendering nothing while checking is not observable with a plain child.
- **`shot`.** The CSS-module proxy answers every key, so the fallback to `styles.md` for an
  unknown radius cannot be seen, and EXIF stripping happens before files reach the component.
- **`qr-placeholder`.** "Every render is identical" always holds because `ROWS` is computed at
  module load, so it cannot catch a seed change.
- **`camera`.** The unmount test cannot tell `release()` apart from the stream effect's own
  cleanup, since both stop the track. The 20-second auto-stop and the 500 ms sampling would
  need fake timers and are not exercised.

One state that looked unreachable is not: a storyboard archived while I still own it. sb_roof is
read-only, so `owner` is false there and every owner control is already gone for the wrong reason.
`board.test.mjs` closes sb_jacaranda through `closeStoryboard` at the end of the file instead —
the fixture's own door, not a hand-edited row — which is what shows that second look deliberately
survives closing while editing, deleting, removing, adding and closing again do not.

Writing these turned up a demo the tests could not have caught on their own: every share code in
the offline dataset had gone dead. sl_1 was the live one and its expiry was a written-down date,
2026-09-19, so once the clock passed it the share screen drew no Turn off button at all and the
demo could not show the thing the paragraph of copy directly under that list spends its length
explaining. Relative now, and `lib/fixtures.test.mjs` holds the list to one live, one expired and
one turned off.

## Checked in a browser

One thing left this section on 2026-09-17. The masking — `redact`, `maskedFrame`, `grabStill`
— needs a canvas, so it lived here and nowhere else, and that is precisely how the worst bug
of that day shipped with every test green: an empty box list read as a failure, so the
ordinary sighting with nothing to cover silently lost the author's own photograph. The
drawing surface is a parameter now, defaulting to the real DOM and replaced in
`lib/masking.test.mjs` by a stand-in that records what was drawn. Thirteen tests assert how
many rectangles were painted and where, and both directions were checked by mutation:
reverting the empty-list behaviour fails one of them, and a `redact` that exports the frame
without painting anything fails four.

More left under #38, listed below where it went. What stays needs a real browser: a real
pointer drag over real layout, StrictMode's double invoke in dev, and real `offsetParent`
values. These were measured against `npm run dev` on 2026-09-15 by
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
still refused. The drag stays here, because the tests render without StrictMode and draw no
boxes by pointer. `add-mask.test.mjs` now pins the rest on seeded boxes: one remove takes away
one box and leaves the others, the last remove closes the gate, and a box opens it.

**The consent sheet.** Moved out. It is `ui.js`'s `Sheet`, and `ui.test.mjs` pins focus on
the panel at open, Tab and Shift+Tab wrapping at the two ends, Escape closing without reaching
a listener behind it, and focus going back to the opener. `add-mask.test.mjs` pins
`aria-modal` and a heading the name points at on the consent sheet itself. One part still
belongs here: jsdom reports `offsetParent` as null for everything, so the Tab tests fake it,
and only a real browser shows the trap finding the controls that are actually visible.

**The rest of the screens.** Every route was loaded and the console read: no errors and no
warnings beyond React's own DevTools notice. No test reads the console, so that still needs a
browser. The write screen's bounce to the species step when the draft has none is now
`add-write.test.mjs`.

**Walked again on 2026-10-04**, after the Next.js 15.5.27 bump and everything since 09-15, in
`fixtures` mode on the dev server. Every route's console was clean. On the mask screen under
StrictMode one drag gave one box at the dragged geometry, a twitchy tap gave none, and removes
took away one box each. The consent sheet's trap, driven by real Tab and Shift+Tab presses,
cycled its two visible buttons in both directions and Escape put focus back on Next. With
`getUserMedia` returning a canvas stream, so that recording, timing and extraction were all
real, a three-second clip came out as eight distinct 640×480 stills under the "your own clip"
line. A clip picked from the library whose WebM reports an Infinity duration falls back to the
placeholders, as `lib/stills.js` says it should. One thing was wrong: the frame scrubber
answered only to a pointer, so Tab never reached it and a keyboard user posted whichever frame
the screen opened on. It is a slider now (#43), pinned in `add-frame.test.mjs` and pressed
again in the browser with real keys.

**Never covered by the tests, by construction.** `camera.test.mjs` and `add.test.mjs` stand in
for `getUserMedia`, `Image` and the canvas, so a real permission prompt, a real frame drawn from
video and the pixels that come out are only ever seen in a browser. So is layout, and so is
anything timed against a real stream or network rather than the fixtures' timers.

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
