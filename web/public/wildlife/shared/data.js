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
    image: "assets/species-flying-fox.svg",
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
    image: "assets/species-water-dragon.svg",
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
    image: "assets/species-magpie.svg",
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
    image: "assets/species-kangaroo.svg",
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
    image: "assets/species-blue-tongue.svg",
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
  approximateTime: ["During the evening","Around dusk","During the day","During the day","Late afternoon","During the day"][i],
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
export const sampleOutcome = {
  id: "outcome-demo",
  opportunityId: "habitat-completed-demo",
  title: "Caring for shared green spaces",
  publicArea: areas[0],
  completedAt: "2026-01-01",
  actionsCompleted:
    "Sample: residents planted native shrubs and removed litter.",
  communityMessage:
    "Demonstration outcome only. No measured habitat impact or animal use is claimed.",
  approvedImage: null,
  noWildlifeHandling: true,
  published: true,
  sample: true,
};
