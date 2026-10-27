# Public-display observation guidance

Only the situation selector on `help.html` is replaced. The page heading, safety introduction, professional-contact filtering, official reference, Return/Home navigation, forest-green/cream styling and safe-observation footer remain. A labelled QR opens Fencepost’s existing private-help route without carrying the typed description. No AI writing assistance is restored to Fencepost; its forms and its own help page are unchanged.

## Visitor experience

The box has the requested heading/supporting copy, a 600-character text field, six starter prompts, Ask AI, Clear text, Start again and Return. Prompts insert text rather than opening result cards. Back/Next move through available controls, including the field; Enter chooses. The physical Back key never navigates away. Existing volume and idle-to-home behaviour is retained.

A pending request shows “Reviewing your description…” and locks submission. Results stay inside the box. The input folds away to make the result easier to read; Edit description restores the existing text. Clear and Start again erase text and results and cancel a pending request. A permanent disclosure states the limits of description-only guidance. A polite status region announces changes without repeating the response visually. Input and output are memory-only, cleared on pagehide, visibility loss, inactivity or disposal. They are never written to localStorage/sessionStorage, included in QR codes, or appended to a conversation history.

## Privacy and safety boundary

Free text stays on the display. The network sends only a small array of recognised general signs such as bleeding, stillness or trapping, never the visitor’s words, names, addresses, number plates, images, identity or a precise wildlife location. Recognisable private details are also blocked at the form. The API rejects free-text and additional-field payloads. This deliberately limits the model’s context; unfamiliar wording can be missed, so the display never certifies health and recommends professional advice when uncertain. Negated risk terms are treated conservatively rather than used to reassure.

A model may select only one of the four requested urgency categories and a supported reason code. The server composes the explanation, next step, avoidance guidance, professional-assistance recommendation, uncertainty and source from the fixed project library. It does not accept model-written medical prose, contact numbers, treatments, handling instructions, species identification or source links. High-risk signs override the model and produce professional or urgent assistance recommendations. Unusual movement cannot produce Observe safely. Observe safely never means confirmed healthy.

Invalid output receives the requested safe fallback. Missing credentials, internet failure and provider timeout use explicitly labelled offline keyword guidance, including the fallback explanation. Responses differ by the signs described. Sources remain separate from residents’ observations.

The fixed information reference is the existing [Queensland Government wildlife-care page](https://www.qld.gov.au/environment/plants-animals/animals/care-injured-wildlife). The public contact list still displays only contacts with the existing verified/source/review fields. No numbers, review date or government approval of AI were invented. This cloud’s request to the official page was blocked (403), so fresh editorial verification is not claimed; the existing review-pending note remains visible.

## Hosting and server configuration

The plain static display works without a server using honest offline guidance. `shared/config.js` leaves `wildlifeHelpEndpoint` empty in that mode. The existing Next preview hosts the display at `/wildlife/help.html` and provides `POST /api/wildlife-help`. Build/dev configuration binds that relative endpoint. The companion `/park` does not mount this feature.

Set these **server-only** Next environment variables to enable live classification:

- `WN_HELP_API_KEY`: provider key, never NEXT_PUBLIC.
- `WN_HELP_MODEL`: explicit compatible model name; without both key and model, offline mode is used.
- `WN_HELP_BASE_URL`: optional HTTPS OpenAI-compatible API root; defaults to `https://api.openai.com/v1`.

No new runtime dependency is required. The route uses a fixed system prompt, strict sign-only schema, 1 KB request limit, fixed output allowlist, seven-second upstream timeout, bounded model output and no-store response headers. The display has a ten-second deadline. Neither input nor upstream errors are logged by this route. Six requests per client and thirty overall per minute are permitted in each server process. These are prototype limits; multiple serverless instances would need a shared limiter for a deployment-wide cap. Browser callers must use the same origin. Keep provider retention/spending settings appropriate to the installation. No credentials are added to browser config or the compiled client bundle.

## Validation

`tests/wildlife-help.test.mjs` covers all starter prompts, private/empty/overlong input, high-risk overrides, generic-sign-only transport, allowlisted responses and fallback. Fencepost’s `web/test/wildlife-help-server.test.mjs` covers missing configuration, mocked live classification, invented/invalid output, upstream failure/timeout, request/origin validation and rate limiting.

`tests/browser_wildlife_help.py` checks the preserved page areas and QR, all six prompts with three-button navigation, typing, empty/privacy errors, invalid/live mocked responses, loading lock, cancellation, Return, editing, mobile overflow, no conversation storage and automatic idle clearing. The existing display journeys and manual observation flow are checked separately. Provider calls are mocked in tests; no live provider credentials are configured in this workspace. Screenshots are in docs/screenshots/19-display-help.png and 20-display-help-response.png. Actual touchscreen keyboard behaviour, macro hardware, glare and physical reach still need installation testing.

Final checks passed: 26 display tests, all 522 Fencepost frontend tests (including seven server-route tests), static validation and the Next production build. Browser checks passed both static offline mode and the built display using the actual server route without credentials. Existing display/registration and manual-observation journeys passed. No console/page errors occurred in the exercised visitor paths, and the compiled client/static files contain no provider-key variable or test key. Hosted live-provider connectivity remains unverified until server credentials are configured.
