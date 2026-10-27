# Wildlife Help

The public display’s Is It Hurt? page uses predefined prototype responses selected by recognised words in the description or one of six common-situation prompts. There is no remote service, model, API route or credential requirement for this feature. It does not make an intelligent or medical assessment.

## Visitor experience

The section is named Wildlife Help. It retains “Describe what you noticed” and now says “Tell us what you can safely see, or select one of the common situations below.” The primary action is Get guidance. While selecting the local response, it displays “Checking the information…”. The permanent notice is:

> This general guidance cannot confirm whether an animal is injured. Contact a wildlife professional if you are concerned.

Results are labelled Predefined prototype guidance. Four categories are available: Observe safely, Professional advice recommended, Urgent assistance recommended and Unable to determine. Unrecognised descriptions and the uncertain starter prompt receive the requested Unable to determine paragraph. Risk signs take priority over normal movement; the output never confirms health or species. An unexpected local failure shows conservative professional-contact guidance.

The six prompts, response layout, Edit description, Clear text, Start again and Return remain. Back and Next cycle available controls, Enter chooses, and the knob affects volume only. Edit restores the current text; Clear and Start again erase it and cancel pending display updates. Input/output stay only in memory and clear on departure, visibility loss, inactivity or disposal. Nothing is sent over the network or saved to browser storage. Recognisable names, contacts, addresses, coordinates and number plates remain blocked at the field.

## Preserved page and sources

The page heading, safety introduction, reviewed-contact filtering, QR to Fencepost’s private-help route, safe footer, navigation and forest-green/cream design remain. The QR never carries the description. Fencepost’s own help page and manual contribution forms remain separate and unchanged.

The fixed source is the existing [Queensland Government wildlife-care reference](https://www.qld.gov.au/environment/plants-animals/animals/care-injured-wildlife). The two user-confirmed wildlife/human-emergency contacts are configured separately; see CONTACTS.md for their URLs, review basis and confirmation behaviour. No professional approval of the predefined guidance is claimed. The existing review-pending note remains; editorial source/contact checks are still needed before a public installation.

## Implementation and verification

`shared/wildlife-help-policy.js` contains the local response table, recognised words, privacy validation and conservative fallback. `shared/wildlife-help.js` manages temporary field/result state and accessible status announcements. `shared/wildlife-help.css` retains the existing design. Both the static display and Next-hosted display use these same files without a service dependency. Feature-specific server code, tests, environment variables and development binding were removed; unrelated storyboard services retain their own settings.

Unit checks cover all six prompts, all four categories, the exact unknown response, risk priority, privacy, deterministic results, the permanent notice and absence of network/storage logic. Browser checks cover the exact wording, absence of misleading visible terms, keyboard controls, loading lock/cancellation, editing, clearing, Return, privacy, visibility/idle reset, mobile layout, zero API requests and no console/page errors. The normal builds and existing frontend tests are also run. Screenshots: docs/screenshots/19-display-help.png and 20-display-help-response.png.

Keyword matching is deliberately limited and can miss unfamiliar wording or conservatively flag negated risk terms. Visitors should contact a wildlife professional when concerned. Physical controller, touchscreen keyboard, glare and reach still need installation testing.
