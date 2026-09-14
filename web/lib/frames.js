// Placeholder material. **These are not the user's photographs** — they are CC BY-SA 4.0
// images from Wikimedia Commons, matched to timeline entries by species so the interface
// is not a row of empty rectangles.
//
// This has to be said plainly on the /credits page: in a real Fencepost, what sits here is
// a still from the filmer's own video. Using somebody else's photograph alongside a user's
// story without saying so implies "this is the one they filmed".
//
// Processing: originals were 2 to 8 MB, resized to 1200px, stripped of EXIF, GPS and camera
// model, and re-encoded. Stripping metadata is a CLAUDE.md safety line and is not waived
// just because the material came from a public site — a photograph carries where it was
// taken, and this product is about not giving away where you live.
//
// Grading: only one of the four was shot at night. Those with `night: false` are darkened
// and desaturated in CSS, because the whole product happens between dusk and the small
// hours. A graded image is a derivative work, CC BY-SA requires that to be stated, and the
// credits page states it.

export const FRAMES = [
  {
    slug: "ringtail-shorncliffe-night",
    file: "/frames/ringtail-shorncliffe-night.jpg",
    species: "ringtail",
    night: true,
    alt: "Two ringtail possums in the rafters of a park shelter at night",
    where: "Moora Park, Shorncliffe, Brisbane",
    author: "John Robert McPherson",
    licence: "CC BY-SA 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    source: "https://commons.wikimedia.org/wiki/File:Common_ringtail_possum_Moora_Park_Shorncliffe_P1110079.jpg",
  },
  {
    slug: "ringtail-brisbane",
    file: "/frames/ringtail-brisbane.jpg",
    species: "ringtail",
    night: false,
    alt: "A ringtail possum on the ground among fallen leaves, looking at the camera",
    where: "Brisbane",
    author: "Andrew Mercer",
    licence: "CC BY-SA 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    source: "https://commons.wikimedia.org/wiki/File:Common_Ringtail_Possum_-_AndrewMercer_IMG14110.jpg",
  },
  {
    slug: "ringtail-brisbane-park",
    file: "/frames/ringtail-brisbane-park.jpg",
    species: "ringtail",
    night: false,
    alt: "A ringtail possum climbing among thin branches, seen from below",
    where: "A park in Brisbane",
    author: "Andrew Mercer",
    licence: "CC BY-SA 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    source: "https://commons.wikimedia.org/wiki/File:Ringtail_Possum._Brisbane.jpg",
  },
  {
    slug: "brushtail-botanic-gardens",
    file: "/frames/brushtail-botanic-gardens.jpg",
    species: "brushtail",
    night: false,
    alt: "A brushtail possum on a tree branch, turned towards the camera",
    where: "City Botanic Gardens, Brisbane",
    author: "Andrew Mercer",
    licence: "CC BY-SA 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    source: "https://commons.wikimedia.org/wiki/File:Brushtail_Possum_-_AndrewMercer_IMG40144.jpg",
  },
];

// The same entry has to get the same picture every time, or a refresh changes the image and
// it looks broken. So the index is derived from the id rather than chosen at random.
function pick(list, seed) {
  let hash = 0;
  for (const ch of String(seed)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return list[hash % list.length];
}

export function frameForSpecies(species, seed) {
  const matching = FRAMES.filter((f) => f.species === species);
  // No picture when the species is other or unknown, or when there is no entry yet —
  // forcing a possum in would assert on the user's behalf what they filmed, and visual
  // identification never setting the species is one of this project red lines.
  if (!matching.length) return null;
  return pick(matching, seed);
}

export function frameFor(entry) {
  if (!entry) return null;
  return frameForSpecies(entry.species, entry.id);
}
