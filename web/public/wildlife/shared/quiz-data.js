// Reference-backed educational content. These are species facts, not sightings
// or identification/rescue advice. Source links are retained per question.
const museum = (title, path) => ({
  title: `Australian Museum — ${title}`,
  url: `https://australian.museum/learn/animals/${path}/`,
});
export const quizSources = {
  brushtail: museum(
    "Common Brushtail Possum",
    "mammals/common-brushtail-possum",
  ),
  "flying-fox": museum(
    "Grey-headed Flying-fox",
    "mammals/grey-headed-flying-fox",
  ),
  "water-dragon": museum("Water Dragon", "reptiles/water-dragon"),
  magpie: museum("Australian Magpie", "birds/australian-magpie"),
  kangaroo: museum("Eastern Grey Kangaroo", "mammals/eastern-grey-kangaroo"),
  "blue-tongue": museum("Blue-tongue Lizard", "reptiles/blue-tongue-lizard"),
};
const question = (id, prompt, answers, correct, explanation) => ({
  prompt,
  answers,
  correct,
  explanation,
  source: quizSources[id],
});
export const quizzes = {
  brushtail: [
    question(
      "brushtail",
      "When is a brushtail possum usually active?",
      ["In the middle of the day", "During the night", "Only at sunrise"],
      1,
      "Brushtail possums are mainly nocturnal: they usually move and feed at night.",
    ),
    question(
      "brushtail",
      "What helps a brushtail possum climb?",
      [
        "Sharp claws that grip",
        "Webbed feet for paddling",
        "Skin folds for gliding",
      ],
      0,
      "Sharp claws help brushtail possums grip as they climb. They climb rather than glide.",
    ),
    question(
      "brushtail",
      "Which place offers a natural daytime shelter?",
      [
        "The open middle of a lawn",
        "An exposed rock in the sun",
        "A hollow inside a tree",
      ],
      2,
      "Brushtail possums commonly shelter in tree hollows during the day. Old hollow-bearing trees provide valuable shelter.",
    ),
  ],
  "flying-fox": [
    question(
      "flying-fox",
      "What is a flying fox usually doing in its daytime camp?",
      ["Roosting in trees", "Grazing on grass", "Hunting insects over a pond"],
      0,
      "Grey-headed flying foxes roost in trees during the day and leave to feed around dusk.",
    ),
    question(
      "flying-fox",
      "Which food suits a grey-headed flying fox?",
      [
        "Grass roots and seeds from the ground",
        "Nectar, pollen and fruit",
        "Fish and water insects",
      ],
      1,
      "Grey-headed flying foxes feed on nectar, pollen and fruit. Flowering and fruiting trees are important feeding habitat.",
    ),
    question(
      "flying-fox",
      "How can flying foxes help plants?",
      [
        "By digging channels beside roots",
        "By pruning branches for nests",
        "By moving pollen and dispersing seeds",
      ],
      2,
      "Flying foxes help pollinate flowering trees and disperse seeds as they move between feeding places.",
    ),
  ],
  "water-dragon": [
    question(
      "water-dragon",
      "Which setting best suits an eastern water dragon?",
      [
        "A dry open paddock with no water",
        "Vegetation beside a creek",
        "A sandy ocean beach",
      ],
      1,
      "Water dragons use habitat near waterways, with vegetation and places to bask.",
    ),
    question(
      "water-dragon",
      "Why might a water dragon rest on a sunny rock?",
      [
        "To warm its body",
        "To guard eggs laid on the rock",
        "To cool itself away from sunshine",
      ],
      0,
      "Water dragons bask in sunshine to warm their bodies. They are reptiles and use external warmth.",
    ),
    question(
      "water-dragon",
      "What might a water dragon do when threatened?",
      [
        "Glide from tree to tree",
        "Curl into a spiny ball",
        "Dive into the water",
      ],
      2,
      "Water dragons are capable swimmers and may dive into water to escape a threat. This is a reason to give them space, not test their response.",
    ),
  ],
  magpie: [
    question(
      "magpie",
      "What does a magpie commonly forage for on the lawn?",
      [
        "Insects and other small animals",
        "Fresh grass blades",
        "Tree leaves and bark",
      ],
      0,
      "Australian magpies forage on the ground for insects and other small animals.",
    ),
    question(
      "magpie",
      "Which landscape gives magpies useful feeding ground?",
      [
        "Only dense forest without open ground",
        "Only rocky offshore islands",
        "Open grassy areas with nearby trees",
      ],
      2,
      "Magpies use open habitats, including parks and grassy areas with trees. Open ground gives them places to forage.",
    ),
    question(
      "magpie",
      "A magpie calls from a tree. Which description fits its voice?",
      [
        "A single unchanging note",
        "Rich, varied carolling calls",
        "Only soft, repeated cooing",
      ],
      1,
      "Australian magpies are known for rich, varied carolling. Listening quietly is one way to enjoy them without approaching.",
    ),
  ],
  kangaroo: [
    question(
      "kangaroo",
      "What makes up much of an eastern grey kangaroo’s diet?",
      ["Insects under bark", "Fruit high in the canopy", "Grasses"],
      2,
      "Eastern grey kangaroos are grazers. Grasses are an important part of their diet.",
    ),
    question(
      "kangaroo",
      "Which time often brings more grazing activity?",
      [
        "Dawn or dusk",
        "Only the hottest part of the day",
        "Only during a rainstorm",
      ],
      0,
      "Eastern grey kangaroos often feed in the cooler hours around dawn and dusk. Activity can vary with conditions.",
    ),
    question(
      "kangaroo",
      "Which landscape combines feeding ground and shelter?",
      [
        "Mangroves and tidal flats",
        "Grassland beside open woodland",
        "Dense forest without grassy openings",
      ],
      1,
      "Eastern grey kangaroos use grassland and open forest or woodland: grassy areas provide food and trees offer shelter.",
    ),
  ],
  "blue-tongue": [
    question(
      "blue-tongue",
      "What kind of diet does a blue-tongued lizard have?",
      [
        "Only leaves",
        "Both plant and animal food",
        "Only insects caught in flight",
      ],
      1,
      "Blue-tongued lizards are omnivores: they eat a mixture of plant and animal food.",
    ),
    question(
      "blue-tongue",
      "Where might a blue-tongue find shelter in a garden?",
      [
        "Among leaf litter and ground cover",
        "Hanging from a high branch",
        "In an open bowl of water",
      ],
      0,
      "Blue-tongues are ground-dwelling lizards. Leaf litter and cover offer places to shelter.",
    ),
    question(
      "blue-tongue",
      "A blue-tongue opens its mouth and shows its tongue. What can this mean?",
      [
        "It wants someone to feed it",
        "It is inviting a closer look",
        "It is trying to deter a threat",
      ],
      2,
      "A blue-tongue may display its blue tongue when threatened. Give it space rather than trying to make it repeat the display.",
    ),
  ],
};
