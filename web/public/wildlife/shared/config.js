// Public configuration only. Never put a service-role key here.
export const config = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  fencepostBaseUrl: "", // Empty uses this deployment's /fencepost/ companion.
  park: "local-park",
  wildlifeHelpEndpoint: "", // Empty: explicit offline guidance. Next binds its server route.
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
  reviewerOrganisation: "Prototype demonstration moderator",
};

// Deployment public configuration
Object.assign(config, {"wildlifeHelpEndpoint":"/api/wildlife-help"});
