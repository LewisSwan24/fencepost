# Wildlife and human-emergency contacts

The Is It Hurt? page now offers two separate contact cards. RSPCA Queensland is the primary wildlife-assistance option for injured, sick, orphaned or trapped wildlife. Triple Zero is a visually distinct human-emergency option, with the explicit warning that an injured animal alone is not a reason to call it. The phone companion uses the same cards and confirmation logic so the handoff remains consistent.

`shared/config.js` contains the single canonical `assistanceContacts` configuration: dialling numbers, formatted numbers, mnemonic labels, descriptions, warning, confirmation text, official source URLs and review date. `shared/contacts.js` derives every telephone link and label from it. No number is hardcoded into the page components. Existing separately reviewed contacts may still appear; duplicates of the two standard numbers are excluded from that ordinary list, including Triple Zero.

The telephone links are `tel:1300264625` and `tel:000`. Selecting either initial link prevents direct activation and opens the specified confirmation. Cancel receives initial focus to avoid an accidental second Choose activating a call. Back/Next wrap between Call and Cancel; Choose activates the highlighted action. Touch, native Tab navigation and Escape remain available. Cancel/Escape restores focus to the original contact. Only the confirmed link passes through to the device's telephone handler; no automatic calls or remote call service are used.

The confirmation makes clear that Triple Zero is for urgent police, fire or ambulance needs involving serious injury, immediate danger or a serious accident, not ordinary wildlife rescue. Both cards have labelled phone icons, large targets and different colour treatments. The contact styles are scoped to these cards and dialogs.

## Sources and review

- Australian Government — Triple Zero: https://www.triplezero.gov.au/
- Queensland Government — wildlife care: https://www.qld.gov.au/environment/plants-animals/animals/care-injured-wildlife
- RSPCA Queensland — wildlife care: https://www.rspcaqld.org.au/what-we-do/care-for-wildlife

The configured review date is 2026-10-27. Both numbers and their intended purposes were explicitly confirmed in the user's instructions and reviewed against this implementation. Live retrieval of the official pages was blocked by this cloud network (403), so a fresh online source check is not claimed. The configuration retains this review basis alongside the URLs and date. Recheck the official pages before an exhibition installation or whenever updating the numbers.

## Verification

Unit tests check the configured purposes/numbers, generated links/labels, source/review metadata, configuration changes and duplicate suppression. Browser tests cover both display and companion: initial selection opens a dialog without allowing dialling, confirmation has the correct telephone link, physical controls wrap/choose, Cancel/Escape and touch work, focus returns correctly, targets exceed 44 × 44 px and mobile layout has no overflow.

In tests only, the browser's confirmed telephone action is intercepted after verifying that the application allowed the native action. No actual call is placed, especially to emergency services. Native telephone-app/dialler availability still requires a supported phone/device check; it cannot be established by a headless browser.

The existing local Wildlife Help wording/logic, privacy/idle behaviour and manual observation journeys are also checked. The retired remote-help route remains absent. Screenshots: docs/screenshots/21-assistance-contacts.png, 22-wildlife-call-confirmation.png and 23-emergency-call-confirmation.png.
