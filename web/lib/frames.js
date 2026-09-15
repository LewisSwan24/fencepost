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
// Grading: only one of the ten was shot at night. Those with `night: false` are darkened
// and desaturated in CSS, because the whole product happens between dusk and the small
// hours. A graded image is a derivative work, CC BY-SA requires that to be stated, and the
// credits page states it.
//
// Why there are five of each species rather than however many turned up: the picture is
// chosen from within the species by a hash of the entry id, so a species holding a single
// photograph hands every sighting of it the same one. Brushtail had exactly one, and a
// timeline that repeats a picture down its length reads as broken rather than as a stand-in.
//
// Two candidates genuinely shot after dark were rejected on the way in, and the reason is
// worth keeping: in both, the possum was a dark shape that could not be made out at all.
// These are seen at 170px on a dark timeline, and daylight ones are pushed towards night in
// CSS anyway, so a legible subject is worth more here than a real night sky.

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
    slug: "ringtail-rain",
    file: "/frames/ringtail-rain.jpg",
    species: "ringtail",
    night: false,
    alt: "A ringtail possum on a branch in the rain, looking towards the camera",
    where: "Roma Street Parkland, Brisbane",
    author: "Andrew Mercer",
    licence: "CC BY-SA 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    source: "https://commons.wikimedia.org/wiki/File:Common_Ringtail_Possum_-_AndrewMercer_-_DSC11167.jpg",
  },
  {
    slug: "ringtail-family",
    file: "/frames/ringtail-family.jpg",
    species: "ringtail",
    night: false,
    alt: "Two ringtail possums together on a branch, seen from below against the sky",
    where: "Brisbane",
    author: "Andrew Mercer",
    licence: "CC BY-SA 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    source: "https://commons.wikimedia.org/wiki/File:Common_Ringtail_Possum_-_AndrewMercer_IMG13848.jpg",
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
  {
    slug: "brushtail-trunk",
    // The only one of the ten shot in portrait. It was cropped to landscape here rather
    // than left to object-fit: cover, which centre-crops and would have taken the head off.
    file: "/frames/brushtail-trunk.jpg",
    species: "brushtail",
    night: false,
    cropped: true,
    alt: "A brushtail possum clinging to a tree trunk, facing the camera",
    where: "Roma Street Parkland, Brisbane",
    author: "Andrew Mercer",
    licence: "CC BY-SA 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    source: "https://commons.wikimedia.org/wiki/File:Brushtail_Possum_IMG_4994.jpg",
  },
  {
    slug: "brushtail-peeking",
    file: "/frames/brushtail-peeking.jpg",
    species: "brushtail",
    night: false,
    alt: "A brushtail possum peering out from behind a tree trunk",
    where: "Roma Street Parkland, Brisbane",
    author: "Andrew Mercer",
    licence: "CC BY-SA 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    source: "https://commons.wikimedia.org/wiki/File:Brushtail_Possum_IMG_5017.jpg",
  },
  {
    slug: "brushtail-joey",
    file: "/frames/brushtail-joey.jpg",
    species: "brushtail",
    night: false,
    alt: "A brushtail possum carrying a baby on its back, among branches",
    where: "Roma Street Parkland, Brisbane",
    author: "Andrew Mercer",
    licence: "CC BY-SA 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    source: "https://commons.wikimedia.org/wiki/File:Brushtail_Possum_with_baby_-_AndrewMercer_-_DSC10674.jpg",
  },
  {
    slug: "brushtail-palm",
    file: "/frames/brushtail-palm.jpg",
    species: "brushtail",
    night: false,
    alt: "A brushtail possum and its baby in the fronds of a palm",
    where: "Roma Street Parkland, Brisbane",
    author: "Andrew Mercer",
    licence: "CC BY-SA 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    source: "https://commons.wikimedia.org/wiki/File:Brushtail_Possum_with_baby_-_AndrewMercer_-_DSC10721.jpg",
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
