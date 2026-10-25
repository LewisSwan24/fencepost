# Wildlife Neighbours + Fencepost park prototype

A public wildlife display and a browser-based park experience share a moderated content model. The existing cream, forest green and rust visual identity remains. Six genuine interview participants inform the design; fictional coding-practice interviews are excluded. See [DESIGN.md](DESIGN.md), [IMPLEMENTATION.md](IMPLEMENTATION.md) and [docs-audit.md](docs-audit.md).

## Run locally

Use a local server, not a file:// URL: browser ES modules need HTTP.

```sh
python3 -m http.server 8020 --bind 0.0.0.0
```

Open `http://localhost:8020/index.html` on your own computer. The companion is `http://localhost:8020/fencepost/index.html#stories`. Those local addresses are development instructions, not hosted previews. No install is required for the static site. Node 20+ runs the checks:

```sh
npm test
npm run build
```

The separate Fencepost repository remains Next.js. Its new park entry points are `/` and `/park`; `/legacy` preserves the original storyboard home. Its other existing routes and Python/Turso backend remain. Run `npm ci` and `npm run build` in that repository's `web/` directory. Local font files retain the original Figtree and Caprasimo typography without a Google Fonts build dependency.

## Two explicit modes

With empty backend fields in `shared/config.js`, **local demo mode** uses fictional seeds and browser localStorage. Moderation is an explicit demo role, not secure authentication. Anyone with browser access can inspect this data. Never enter real names, addresses, rescue reports or email addresses in demo mode. Tabs on the same origin update the display through storage events. Separate devices/origins do not share demo data.

With both Supabase URL and public **legacy anon JWT** key configured, **connected mode** uses REST/RPC, Supabase Auth for moderators and private Storage for pending media. It never silently falls back to demo on a backend error. Both deployments must use the same project. Live provisioning, actual Auth/Storage integration and deployment are not verified here; see setup below. Registrations are explicitly local demonstration records even in connected mode: they never contact an organiser or reserve a place.

## Shared Supabase setup

Use a new development Supabase project, separate from existing storyboard data. The original Fencepost Python/Turso schema and generated files are untouched. Supabase is an additive, isolated moderation backend, not a migration or replacement for Turso. This separation avoids exposing permissioned legacy entries through anonymous public reading.

1. Apply `supabase/001_schema.sql` in the Supabase SQL editor. It creates the new tables, RLS policies, RPCs and two Storage buckets. This is an initial migration, not a repeatable reset; do not run it against an unrelated existing schema.
2. Load the fictional seeds from `supabase/002_seed.sql`. Regenerate them with `node scripts/seed.mjs > /tmp/wn-seed.sql`. Seeds are idempotent by deterministic IDs. They contain no real event or rescue address.
3. In Supabase Authentication, create/invite the moderator account. Anonymous browsing/submission do not need an Auth user. Add the account's UUID to `public.moderators` from the SQL editor:

   ```sql
   insert into public.moderators(user_id, organisation)
   values ('YOUR_AUTH_USER_UUID', 'YOUR RESPONSIBLE REVIEW ORGANISATION');
   ```

   Never let clients add their own moderator membership. A valid Supabase login without this row is refused by the moderator UI and database policies.
4. Put only the public project URL and legacy anon JWT key into `shared/config.js`. Never use service-role or `sb_secret_` keys. `.env.example` documents the public bindings; static GitHub Pages does not automatically inject `.env` files.
5. Set `fencepostBaseUrl` to the actual preview deployment's `/park` URL (or deployed static companion). QR codes are generated locally from this configuration with a park query and story/opportunity hash. Do not point them at the unchanged production Fencepost deployment while testing new routes.
6. In Fencepost's Vercel preview settings use `NEXT_PUBLIC_WN_SUPABASE_URL`, `NEXT_PUBLIC_WN_SUPABASE_ANON_KEY` and optionally `NEXT_PUBLIC_WN_FENCEPOST_URL`. `web/scripts/configure-wildlife.mjs` writes public configuration during `prebuild`; it rejects recognised service-role/secret keys. No secret values belong in the repository.
7. Sign in at the mobile `#moderator` route. Configure reviewed official contacts with their source and review date. The empty contact state is intentional: no current official phone number was independently verified in this environment.
8. Test anonymous submission → authenticated review → approval → display update, on two devices/origins, before claiming hosted readiness. The connected display polls the public story projection every 30 seconds. It never requests the private observation table.

Default Supabase rate limits alone are not a complete anti-spam system. Before a real public deployment add an appropriate submission/CAPTCHA/rate-limit gateway, retention policy, responsible reviewer, incident response and data-protection arrangements. This remains a demonstration prototype.

## Routes and journeys

| Public display | Purpose |
| --- | --- |
| `index.html` | Four zones, rotating approved stories, previous/next, pause and optional narration |
| `help.html` | Five situations, source-linked guidance and verified-contact configuration |
| `animals.html` | Six species |
| `species.html?animal=brushtail` | One species, source and optional responsible-response activity |
| `community.html` | Labelled Fencepost QR and one secondary sample action |
| Legacy `quiz.html`, `sounds.html`, `stories.html` | Compatibility redirects; no duplicate primary features |

Fencepost hash routes: `#stories`, `#story/ID`, `#learn`, `#species/ID`, `#share`, `#rescue`, `#preview`, `#sent`, `#receipts`, `#help`, `#community`, `#opportunity/habitat-demo`, `#register/habitat-demo`, `#registrations`, `#moderator`, `#credits`.

No account gate is shown on the public park experience. Text-only posting and Not sure identification are first-class options. A photo or MP4/WebM clip under 5 MB is optional; clips become a single still. All media is re-encoded as JPEG to remove metadata; originals are not retained. Pending media is private in connected mode. Human privacy checks are required before approval. Contributors receive a browser-held receipt that supports a removal request, not access to the private queue.

Discussion is only on the mobile approved-story detail, and every comment is pending until moderator approval. Reports and removal requests remain in the moderator view. No model-generated advice, permanent cameras, live animal tracking, public identities, exact location maps, popularity rankings or automatic posting is added.

## Physical controls

All display features use three controls, configured only in `shared/config.js`:

- Back: Escape; closes a source handoff/detail or returns to the parent page. At home it stays home.
- Choose: Enter; activates the highlighted choice.
- Next: ArrowRight; cycles all available choices, including story navigation and activity answers.

Permanent on-screen Back/Choose/Next buttons mirror the hardware. The selected option has a border, shadow and “▶ Selected” marker, not colour alone. External sources and mobile handoffs open a scannable source panel on the kiosk, so the three-button user can return without controlling another browser tab.

The default volume knob is system volume. The browser cannot reliably observe OS volume changes; use the OS indicator. Software mode is optional: set `volume.mode` to `software`, customise the configured volume keys, or emit `new CustomEvent('wn-knob', {detail:{delta:1}})` for clockwise and `delta:-1` for anticlockwise. This signal changes volume only and shows an accessible temporary indicator; it is not a fourth required navigation key. Session volume persists over idle/home navigation. Software narration restarts at the new volume because Web Speech cannot reliably change an in-progress utterance's volume. Actual iPad/USB hardware and speakers still need testing.

After two minutes without input, stop audio, close overlays, return home/reset the story and focus the first option; keep volume. Reduced-motion users start with story rotation paused.

## Deployment and synchronisation

**Display / GitHub Pages:** enable Pages for a selected branch or deployment workflow after reviewing `design-preview`; no build output directory is needed. Do not change the production Pages branch simply to review this work. All asset/module paths support a repository subpath. Keep `vendor/` and `shared/` in the published files.

**Fencepost / Vercel:** deploy `wildlife-neighbours-preview` as a preview branch with `web/` as Root Directory, `npm run build`, and the existing Next.js framework setting. The original API project is unchanged and does not need deployment for this isolated park flow. New park URLs are not claimed to exist on the production domain until that branch is deployed.

The display repository is the source of shared park files. After editing it, run from this checkout:

```sh
node scripts/sync-fencepost.mjs /path/to/fencepost
```

Review and commit the copied `web/public/wildlife/` files on Fencepost's separate branch. This copy includes a same-origin static demo companion and display, enabling a browser-only demonstration inside one Vercel preview origin. Do not merge legacy storyboard content into the public story model.

**Demo reset:** moderator → Reset fictional demo data (with confirmation) resets fictional observations/stories/comments/outcomes only. Registration records and receipts can contain independent demo activity; remove only `wn-registrations`, `wn-receipts`, `wn-demo-v2` in browser site storage for a complete local reset. Do not clear unrelated legacy Fencepost storage. Connected data is never reset by this button.

## Validation

- `npm test`: data projection, moderation gates, comments, area constraints and sample verification.
- `npm run build`: script syntax, required entry points, controls and assets.
- `python3 tests/browser_journeys.py`, `python3 tests/browser_privacy.py` and `python3 tests/browser_states.py`: Playwright + Chromium, with this site running at port 8020. Set `WN_TEST_BASE` to another HTTP base if needed. Requires Python Playwright and Chromium; no production service is touched.
- `tests/security.sql` and `tests/outcome-security.sql`: executable assertions for a disposable PostgreSQL/Supabase test database after the schema and before seeds. It creates only transaction-local fictional rows and rolls back. It assumes an empty test schema, not production data.
- Fencepost: `TZ=Australia/Brisbane npm test` in `web/`. Its existing date tests assume Brisbane calendar boundaries. `npm run build` validates all old and new Next routes.

See [TESTING.md](TESTING.md) for actual results and remaining manual checks. No live publishing, deployment, official-source verification or fresh-task restoration is claimed.
