// Public configuration only. Never put a service-role key here.
export const config = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  fencepostBaseUrl: "", // Empty uses this deployment's /fencepost/ companion.
  park: "local-park",
  idleMs: 120000,
  rotateMs: 20000,
  keys: { back: "Escape", choose: "Enter", next: "ArrowRight" },
  volume: {
    mode: "system",
    increase: "AudioVolumeUp",
    decrease: "AudioVolumeDown",
    step: 0.1,
  },
  // Publish only contacts checked by the responsible organisation.
  contacts: [],
  reviewerOrganisation: "Prototype demonstration moderator",
};
