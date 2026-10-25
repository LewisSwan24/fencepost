export const areas = [
  "General park area",
  "Community centre area",
  "Park pond area",
  "School oval area",
  "Reserve area",
  "Community garden area",
];
export const times = [
  "Early morning",
  "During the day",
  "Late afternoon",
  "Around dusk",
  "During the evening",
  "Late at night",
];
export const species = [
  {
    id: "brushtail",
    name: "Common brushtail possum",
    scientific: "Trichosurus vulpecula",
    active: "Mostly at night",
    habitat: "Woodland, gardens and urban trees",
    behaviour: "Climbing and feeding among trees",
    fact: "A brushtail possum uses sharp claws to climb.",
    source:
      "https://australian.museum/learn/animals/mammals/common-brushtail-possum/",
    image: "assets/brushtail-peeking.jpg",
  },
  {
    id: "flying-fox",
    name: "Grey-headed flying fox",
    scientific: "Pteropus poliocephalus",
    active: "At dusk and during the night",
    habitat: "Forests and urban tree canopies",
    behaviour: "Roosting by day; feeding on nectar and fruit at night",
    fact: "Flying foxes help disperse seeds and pollinate flowering trees.",
    source:
      "https://australian.museum/learn/animals/mammals/grey-headed-flying-fox/",
    image: "illustration:flying-fox",
  },
  {
    id: "water-dragon",
    name: "Eastern water dragon",
    scientific: "Intellagama lesueurii lesueurii",
    active: "During the day",
    habitat: "Vegetation near waterways",
    behaviour: "Basking on rocks and swimming",
    fact: "Water dragons can swim and dive to escape danger.",
    source: "https://australian.museum/learn/animals/reptiles/water-dragon/",
    image: "illustration:water-dragon",
  },
  {
    id: "magpie",
    name: "Australian magpie",
    scientific: "Gymnorhina tibicen",
    active: "During the day",
    habitat: "Open woodland, parks and grassy areas",
    behaviour: "Foraging on the ground and singing",
    fact: "Australian magpies forage for insects and other small animals.",
    source: "https://australian.museum/learn/animals/birds/australian-magpie/",
    image: "illustration:magpie",
  },
  {
    id: "kangaroo",
    name: "Eastern grey kangaroo",
    scientific: "Macropus giganteus",
    active: "Often at dawn and dusk",
    habitat: "Grassland and open forest",
    behaviour: "Grazing and resting in groups",
    fact: "Eastern grey kangaroos eat grasses.",
    source:
      "https://australian.museum/learn/animals/mammals/eastern-grey-kangaroo/",
    image: "illustration:kangaroo",
  },
  {
    id: "blue-tongue",
    name: "Eastern blue-tongued lizard",
    scientific: "Tiliqua scincoides",
    active: "During the day",
    habitat: "Grass, leaf litter and gardens",
    behaviour: "Basking and sheltering under cover",
    fact: "Blue-tongued lizards eat a mixture of plant and animal food.",
    source:
      "https://australian.museum/learn/animals/reptiles/blue-tongue-lizard/",
    image: "illustration:blue-tongue",
  },
].map((s) => ({
  ...s,
  sourceStatus: "Reference supplied; editorial verification pending",
  reviewedAt: null,
  advice:
    "Observe quietly from a distance. Never approach, feed or handle wildlife.",
}));
export const opportunity = {
  id: "habitat-demo",
  title: "Help improve local wildlife habitat",
  image: "illustration:planting",
  status: "sample",
  organiser: "Example community organisation",
  organiserVerified: false,
  publicArea: "General park entrance",
  dateConfirmed: false,
  date: null,
  startTime: null,
  endTime: null,
  duration: "Approximately two hours",
  description: "Plant native shrubs and remove litter.",
  tasks: [
    "Planting",
    "Litter collection",
    "Watering",
    "Seated preparation",
    "General assistance",
  ],
  suitableFor: "Adults and supervised children",
  equipment: "Gloves and tools provided — sample arrangement",
  accessibility: "Seated and low-mobility tasks available — sample arrangement",
  wildlifeHandling: false,
  registrationMode: "demo",
  registrationOpen: true,
  safety:
    "Follow the organiser’s instructions. Children remain with their supervising adult. Never approach, feed or disturb wildlife.",
  contact: null,
  verifiedAt: null,
  registrationUrl: null,
  weather: "Weather and cancellation arrangements to be confirmed.",
  bring: "Closed shoes, a hat and water — confirm with the organiser.",
};
export function isVerifiedOpportunity(o) {
  let validUrl = false;
  try {
    const u = new URL(o.registrationUrl);
    validUrl =
      u.protocol === "https:" && !!u.hostname && !u.username && !u.password;
  } catch {}
  return Boolean(
    o.status === "verified" &&
      o.organiserVerified === true &&
      o.organiser &&
      !/example|sample|prototype/i.test(o.organiser) &&
      o.dateConfirmed === true &&
      o.date &&
      Number.isFinite(Date.parse(o.date)) &&
      (o.startTime || o.duration) &&
      o.registrationUrl &&
      validUrl &&
      o.safety &&
      o.accessibility &&
      o.contact &&
      o.verifiedAt &&
      Number.isFinite(Date.parse(o.verifiedAt)) &&
      o.wildlifeHandling === false,
  );
}
export const observationSamples = [
  {
    id: "pending-demo",
    nickname: "Park walker",
    possibleSpecies: "brushtail",
    approximateTime: "During the evening",
    publicArea: areas[0],
    behaviour: "Resting in a tree",
    description: "A possum was resting among the branches.",
    status: "pending",
    injuryConcern: false,
  },
  {
    id: "rejected-demo",
    nickname: "Demo contributor",
    possibleSpecies: "magpie",
    approximateTime: "During the day",
    publicArea: areas[3],
    behaviour: "Foraging",
    description:
      "Sample rejected observation retained privately for moderation practice.",
    status: "rejected",
    injuryConcern: false,
  },
  {
    id: "unsure-demo",
    nickname: "Anonymous",
    possibleSpecies: "not-sure",
    approximateTime: "Around dusk",
    publicArea: areas[4],
    behaviour: "Moving among trees",
    description: "I noticed an animal but could not identify it.",
    status: "pending",
    injuryConcern: false,
  },
  {
    id: "rescue-demo",
    nickname: "Anonymous",
    possibleSpecies: "not-sure",
    approximateTime: "During the day",
    publicArea: areas[0],
    privateRescueLocation: "DEMO PRIVATE LOCATION — do not publish",
    condition: "Not moving normally",
    moving: "Not sure",
    nearTraffic: false,
    behaviour: "Appears trapped",
    description: "Fictional welfare report for demonstration only.",
    status: "urgent",
    injuryConcern: true,
  },
].map((o) => ({
  ...o,
  sample: true,
  submittedAt: "2026-01-01T10:00:00Z",
  mediaUrl: null,
}));
export const sampleStories = species.map((s, i) => ({
  id: `story-${s.id}`,
  sourceObservationId: null,
  contentType: "neighbour-observation",
  species: s.id,
  publicArea: areas[i],
  approximateTime: [
    "During the evening",
    "Around dusk",
    "During the day",
    "During the day",
    "Late afternoon",
    "During the day",
  ][i],
  behaviour: s.behaviour,
  storyText: [
    "A neighbour noticed a possible brushtail possum resting in trees near the general park area during the evening.",
    "A neighbour noticed possible grey-headed flying foxes near the community centre area around dusk.",
    "A neighbour noticed a possible eastern water dragon basking beside the park pond during the day.",
    "A neighbour noticed a possible Australian magpie family foraging near the school oval during the day.",
    "A neighbour noticed possible eastern grey kangaroos grazing near the reserve late in the afternoon.",
    "A neighbour noticed a possible blue-tongued lizard resting near the community garden during the day.",
  ][i],
  mediaUrl: s.image,
  verifiedFact: s.fact,
  factSource: s.source,
  reviewedBy: "Prototype demonstration moderator",
  publishedAt: "2026-01-01T10:00:00Z",
  sample: true,
}));
export const historicOpportunity = {
  ...opportunity,
  id: "habitat-completed-demo",
  status: "completed",
  registrationOpen: false,
};
export const sampleOpportunities = [
  opportunity,
  {
    ...opportunity,
    id: "pond-care-demo",
    title: "Care for the park pond",
    publicArea: "Community park pond",
    description:
      "Collect litter with organiser guidance and learn about pond-edge habitat.",
    image: "illustration:pond",
    tasks: ["Litter collection", "Seated preparation", "General assistance"],
  },
  {
    ...opportunity,
    id: "garden-care-demo",
    title: "Help native shelter grow",
    publicArea: "Community garden boundary",
    description:
      "Prepare and plant locally appropriate shrubs with the organiser.",
    image: "illustration:garden",
    tasks: ["Planting", "Watering", "Seated preparation"],
  },
  {
    ...opportunity,
    id: "reserve-care-demo",
    title: "A cleaner reserve entrance",
    publicArea: "Local reserve entrance",
    description: "Join a supervised clean-up on paths and managed park areas.",
    image: "illustration:cleanup",
    tasks: ["Litter collection", "General assistance", "Seated preparation"],
  },
];
export const sampleOutcomes = [
  {
    id: "update-route-demo",
    opportunityId: "habitat-demo",
    title: "Creating a safer wildlife route",
    publicArea: "Local park edge",
    activity: "Native planting and litter removal",
    actionsCompleted:
      "Volunteers planted native shrubs and removed rubbish from the habitat area.",
    whyItMatters:
      "Connected vegetation can provide shelter and safer movement paths for urban wildlife.",
    communityMessage:
      "Thank you to the residents who helped care for our shared environment.",
    approvedImage: "illustration:planting",
  },
  {
    id: "update-pond-demo",
    opportunityId: "pond-care-demo",
    title: "Caring for the park pond",
    publicArea: "Community park pond",
    activity: "Litter collection and habitat-care session",
    actionsCompleted:
      "Volunteers removed litter from the pond surroundings and learned how rubbish can affect birds, frogs and water dragons.",
    whyItMatters:
      "Cleaner pond edges can reduce hazards for animals using the water and surrounding vegetation.",
    communityMessage:
      "Small local actions can create a safer shared space for people and wildlife.",
    approvedImage: "illustration:pond",
  },
  {
    id: "update-shelter-demo",
    opportunityId: "garden-care-demo",
    title: "Restoring native shelter",
    publicArea: "Community garden boundary",
    activity: "Planting locally appropriate shrubs",
    actionsCompleted:
      "Volunteers added native vegetation under the guidance of the activity organiser.",
    whyItMatters:
      "Shrubs may provide shelter and contribute to connected urban habitat.",
    communityMessage: "Thank you for helping improve neighbourhood habitat.",
    approvedImage: "illustration:garden",
  },
  {
    id: "update-reserve-demo",
    opportunityId: "reserve-care-demo",
    title: "A cleaner reserve entrance",
    publicArea: "Local reserve entrance",
    activity: "Supervised park clean-up",
    actionsCompleted:
      "Volunteers collected litter from paths and vegetation without entering sensitive habitat areas.",
    whyItMatters:
      "Removing rubbish can reduce entanglement and ingestion risks for wildlife.",
    communityMessage:
      "The activity combined practical care with learning about local animals.",
    approvedImage: "illustration:cleanup",
  },
].map((o) => ({
  ...o,
  completedAt: "2026-01-01",
  demonstrationDate: "Demonstration date · To be confirmed",
  noWildlifeHandling: true,
  published: true,
  sample: true,
}));
// Retained export for consumers of the earlier demonstration model.
export const sampleOutcome = sampleOutcomes[0];
