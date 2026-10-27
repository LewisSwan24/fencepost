// Public configuration only. Never put a service-role key here.
export const config = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  fencepostBaseUrl: "", // Empty uses this deployment's /fencepost/ companion.
  park: "local-park",
  idleMs: 120000,
  rotateMs: 45000,
  keys: { back: "ArrowLeft", choose: "Enter", next: "ArrowRight" },
  volume: {
    mode: "system",
    eventName: "wn-knob",
    step: 0.1,
  },
  // Publish only contacts checked by the responsible organisation.
  contacts: [],
  // Details reviewed against the user's confirmed requirements on this date.
  // Official URLs are recorded; cloud access to these pages was blocked.
  assistanceContacts: [
    {
      id: "rspca-qld",
      kind: "wildlife",
      name: "RSPCA Queensland",
      heading: "Injured or trapped wildlife",
      description: "Contact RSPCA Queensland for specialist wildlife advice.",
      number: "1300264625",
      formattedNumber: "1300 264 625",
      mnemonic: "1300 ANIMAL",
      confirmationTitle: "Call RSPCA Queensland?",
      confirmationBody:
        "Use this contact for specialist advice about injured, sick, orphaned or trapped wildlife.",
      sourceLabel: "Queensland Government / RSPCA Queensland — 1300 ANIMAL",
      sourceUrls: [
        "https://www.qld.gov.au/environment/plants-animals/animals/care-injured-wildlife",
        "https://www.rspcaqld.org.au/what-we-do/care-for-wildlife",
      ],
      reviewedAt: "2026-10-27",
      reviewBasis:
        "User-confirmed contact details; source URLs recorded, live retrieval blocked.",
    },
    {
      id: "triple-zero",
      kind: "emergency",
      name: "Triple Zero",
      heading:
        "Is a person in immediate danger, seriously injured, or involved in a serious accident?",
      description: "Call Triple Zero.",
      number: "000",
      formattedNumber: "000",
      mnemonic: "Triple Zero",
      warning:
        "Triple Zero is for serious and urgent emergencies involving police, fire or ambulance. Do not call 000 only because an animal appears injured.",
      confirmationTitle: "Call Triple Zero?",
      confirmationBody:
        "Only continue if someone is seriously injured, in immediate danger or urgent police, fire or ambulance assistance is required.",
      sourceLabel: "Australian Government — Triple Zero",
      sourceUrls: ["https://www.triplezero.gov.au/"],
      reviewedAt: "2026-10-27",
      reviewBasis:
        "User-confirmed contact details; source URLs recorded, live retrieval blocked.",
    },
  ],
  reviewerOrganisation: "Prototype demonstration moderator",
};
