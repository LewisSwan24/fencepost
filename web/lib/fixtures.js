// The fixed responses from the prototype. Three contract mismatches were fixed on the way
// across (see the verification report on issue #22):
//   the fourth species value is unknown, not unsure — the real API set is
//     {brushtail, ringtail, other, unknown}, and sending unsure is a straight 400;
//   storyboard status is active | readonly | archived, with no past;
//   there is no role:"vision" — identifying a frame is a neighbour call carrying image_b64
//     and frame_consent, and it answers with {role, reply, prompt_version} as usual.
//
// Why the assistant has to come from here during the demo: a real model can say something
// that crosses a red line, and in the room there is no second chance. See CLAUDE.md. The
// CRUD half runs against the real backend.

// The one import in this file. copy.js imports nothing, so this cannot become a cycle; the
// extension is kept because node --test resolves only the spelled-out path.
import { DEFAULT_EXPIRY_DAYS } from "./copy.js";

export const PROMPT_VERSION = "v0.11";

export const SPECIES = [
  { id: "brushtail", label: "Brushtail", sub: "Common Brushtail Possum" },
  { id: "ringtail", label: "Ringtail", sub: "Common Ringtail Possum" },
  { id: "other", label: "Something else", sub: "Not a possum" },
  { id: "unknown", label: "Not sure", sub: "Leave it open" },
];

export const SPECIES_LABEL = Object.fromEntries(SPECIES.map((s) => [s.id, s.label]));

// The clip the user has just filmed. The server would hold only a storage_key; there is no
// column EXIF could land in.
export const CLIP = {
  default_index: 3,
  frames: [
    { t: 0, label: "0:00", tone: 0 },
    { t: 2, label: "0:02", tone: 1 },
    { t: 4, label: "0:04", tone: 2 },
    { t: 6, label: "0:06", tone: 3 },
    { t: 8, label: "0:08", tone: 2 },
    { t: 10, label: "0:10", tone: 1 },
    { t: 12, label: "0:12", tone: 0 },
    { t: 14, label: "0:14", tone: 1 },
  ],
  // Things in the picture that identify a person or a house, as a percentage of the frame.
  mask_targets: [
    { id: "face", label: "Face", x: 13, y: 30, w: 17, h: 23 },
    { id: "plate", label: "Number plate", x: 55, y: 64, w: 28, h: 14 },
  ],
};

// The response to identifying a frame. The real endpoint answers in prose rather than with
// a structured species field, so this does too — the interface picks the species out of the
// sentence itself (see suggestedSpecies), and where it cannot, only the sentence is shown
// and no "Use this" appears. The same logic then works against the real API, and it
// satisfies "a suggestion is never selected automatically" for free.
export const VISION_REPLY =
  "Looks most like a Brushtail — going by the bushy tail. Check the ears to be sure.";

export function suggestedSpecies(reply) {
  const text = String(reply || "").toLowerCase();
  const hits = ["brushtail", "ringtail"].filter((name) => text.includes(name));
  return hits.length === 1 ? hits[0] : null;
}

// Writer. Candidates only, never filled in for the user. confidence is established or
// unverified, nothing else.
const FUN_FACTS = {
  brushtail: [
    {
      text: "Brushtails are the possum most likely to end up in a Brisbane roof. They den in tree hollows when they can get one, and a roof cavity is the next best thing.",
      confidence: "established",
    },
    {
      text: "People often say the same brushtail comes back to a roof year after year, though that is more neighbourhood lore than anything settled.",
      confidence: "unverified",
    },
  ],
  ringtail: [
    {
      text: "Ringtails build nests called dreys and carry the material with their tail.",
      confidence: "established",
    },
    {
      text: "People often say they only eat leaves, though they take fruit and flowers too.",
      confidence: "unverified",
    },
  ],
  other: [],
  unknown: [],
};

// The tidy-up touches only spacing, capitals and full stops, adding and removing no detail.
// The real Writer does the same job with a model.
function tidy(story) {
  let t = String(story || "").trim().replace(/\s+/g, " ");
  if (!t) return null;
  t = t.replace(/\bi\b/g, "I").replace(/\s+([,.!?])/g, "$1");
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.!?]$/.test(t)) t += ".";
  return t;
}

export function writer(species, story) {
  const facts = FUN_FACTS[species] || [];
  const tidied = tidy(story);
  return {
    role: "writer",
    fun_facts: facts,
    tidied_story: tidied,
    question: tidied ? null : "What was it doing when you started filming?",
    skipped: facts.length === 0,
    prompt_version: PROMPT_VERSION,
  };
}

// ── Assistant conversation ──────────────
// Four demo scripts, implemented word for word from the fixed-response section of
// docs/prompts.md: nothing rewritten, no sentence added.
export const ASSISTANT_SCRIPT = [
  {
    key: "roof",
    question: "How do I catch the possum in my roof?",
    reply:
      "Possums are protected here, so trapping one needs a licensed operator — it's not a DIY job. The part that actually solves it is sealing the entry points, otherwise the next one moves in. The Queensland environment department can point you to licensed controllers.",
  },
  {
    key: "bandicoot",
    question: "I filmed a bandicoot digging up the lawn, what is it doing?",
    reply:
      "Possums are all I know about, sorry. Post it anyway though — plenty of people here will recognise it.",
  },
  {
    key: "snake",
    question: "There's a brown snake on my patio, what do I do?",
    reply:
      "That's outside what I can help with, and I won't guess at a snake either way. Keep people and pets well back, watch it from a distance, and call a licensed snake catcher for your suburb. If anyone's been bitten, call 000 now.",
  },
  {
    key: "others",
    question: "What did the other people write in this storyboard?",
    reply:
      "I can't see anyone else's entries — only what you've written. Scroll the timeline and you'll see them all.",
  },
];

export const ASSISTANT_DISCLOSURE = {
  lead: "Possum Help",
  rest: " — I'm an AI assistant, not a person. I know about brushtail and ringtail possums around Brisbane. Ask me anything about the one you filmed.",
};

export const ASSISTANT_OFFLINE =
  "The assistant is offline right now. Writing and posting work as normal.";

// Another animal, and that animal has to be the subject of the sentence. "Will it hurt my
// cat?" asks about a pet rather than reporting a cat, so it belongs with injured. That is
// also why it sits after injured and welfare.
// Built by joining .source from regex literals rather than writing double backslashes in a
// string: one escape level short and a word boundary becomes a backspace character, which
// matches nothing, silently, for ever. That is exactly how this broke once.
const ANIMAL = /bandicoot|koala|wallaby|kangaroo|rats?|mice|mouse|birds?|magpie|curlew|turkey|cockatoo|lorikeet|kookaburra|cats?|dogs?|fox|goanna|lizard|skink|frog|spider|opossum|raccoon/;
const SAW = /filmed|film|saw|see|caught|got|have|found|watched/;
const DID = /is|was|are|were|has|have|had|keeps?|kept|came|comes?|went|goes|dug|digs?|digging|eating|ate|sitting|sat|running|ran|doing|does|did|got|gets/;

const OTHER_ANIMAL_SUBJECT = new RegExp(
  [
    String.raw`\bi (?:${SAW.source})\s+(?:a|an|the|some|two|my|this)?\s*(?:${ANIMAL.source})\b`,
    String.raw`\b(?:${ANIMAL.source})\s+(?:${DID.source})\b`,
    String.raw`^(?:a|an|the|my|this|that|some|there'?s?(?:\s+is)?\s+(?:a|an|the)?)\s*(?:${ANIMAL.source})\b`,
  ].join("|"),
  "i"
);

// Ordered by subject rather than by whichever word happens to appear: safety first, then
// the branches neighbour.txt and shared.txt actually prescribe, and out-of-scope last.
// Every reply is either one of the four scripts above or comes straight out of those files.
const ROUTES = [
  {
    // shared.txt SAFETY FALLBACK — bats do not get the scope sentence, nothing is said
    // about whether they are safe, and only vaccinated people may touch one.
    key: "bat",
    // "microbat" has no word boundary before "bat", so \bbats?\b missed it and the question
    // fell through to the out-of-scope line — which used to offer to identify the animal by
    // its tail. The prefixes are spelled out rather than dropping the leading \b, because
    // dropping it would catch "wombat" and "combat" too.
    match: /\b(?:micro|mega|fruit[- ]?)?bats?\b|flying.?fox/i,
    // The number carries its hours and the after-hours alternative in the same breath. That
    // is a hard rule in shared.txt every time it is given out, and this line was breaking it.
    reply:
      "Bats are outside what I cover, and I won't say anything about whether one is safe to be near. Keep people and pets back, and don't pick it up — not even if it looks hurt or stuck. Only vaccinated handlers should touch a bat. Call the RSPCA on 1300 ANIMAL (1300 264 625) — they're on 7am to 7pm every day, and their site has the after-hours list. A bite or scratch means 000 and medical help straight away.",
  },
  // The dangerous ones are routinely named without the word "snake" — nobody says "taipan
  // snake". Missing them sent the question to the out-of-scope line, which used to offer to
  // identify it. shared.txt: never identify a snake, not even when the user names the species
  // themselves, so the list is here to catch the naming, not to do the identifying.
  {
    key: "snake",
    match: /\bsnakes?\b|\bpython\b|\bviper\b|\badder\b|\btaipan\b|\beastern brown\b|\bred.?bell(?:y|ied)\b|\bking brown\b|\bmulga\b|\bcopperhead\b|\bwhip.?snake\b|\bblack snake\b/i,
    script: "snake",
  },
  {
    // neighbour.txt CONTEXT BOUNDARY — somebody else's entry.
    key: "others",
    match: /other (people|entries|contributors|storyboard)|anyone else|everyone else|what did .*(write|post|say)|who (posts|posted|writes)|most (posts|entries)/i,
    script: "others",
  },
  {
    // CONTEXT BOUNDARY — cannot share, invite or grant access; point at the control and stop.
    key: "access",
    match: /invite|share|\bqr\b|revoke|give .* access|post (this|it) for me|on my behalf/i,
    reply:
      "I can't share a storyboard or invite anyone — that part is yours. The Share button on the storyboard is where the QR code and the access settings live.",
  },
  {
    // neighbour.txt INJURED, SICK OR ORPHANED — no judgement; call the RSPCA first.
    key: "injured",
    match: /injur|\bhurt\b|sick|bleeding|\bdead\b|dying|orphan|\bbaby\b|\bjoey\b|stuck|caught in/i,
    reply:
      "I can't tell how badly hurt it is, so don't touch it yet. Call the RSPCA on 1300 ANIMAL (1300 264 625) and they'll tell you whether handling it is the right move — they're on 7am to 7pm every day, and their site has the after-hours list. Keep your distance and keep pets away until then.",
  },
  {
    // shared.txt ANIMAL WELFARE HARD RULE — matches an intent to feed or to handle, not
    // the noun food. "Do they eat fruit?" is a question about diet.
    key: "welfare",
    match: /\bfeed(s|ing)?\b|hand.?feed|give (it|them|him|her)\b|leave (out|some|food|fruit)|put out (food|fruit|bread)|\bbait\b|\blure\b|\btouch\b|hold (it|them)|\bpat\b|pick (it|him|her|them) up|\bwake\b/i,
    reply:
      "Best not to — feeding them or handling them does harm, even when it's meant kindly. Watch from a distance and let it get on with what it's doing.",
  },
  { key: "other_animal", match: OTHER_ANIMAL_SUBJECT, script: "bandicoot" },
  {
    // neighbour.txt POSSUM IN A ROOF OR WALL.
    key: "roof",
    match: /in (my|the) (roof|ceiling|wall)|roof (cavity|space)|\btrap|relocat|seal|entry point|get (it|them) out|living in/i,
    script: "roof",
  },
  {
    // neighbour.txt DIET — diet is in scope. Answer it, rather than turning it into a line
    // about not feeding them.
    key: "diet",
    match: /\beat\b|\beats\b|\bdiet\b|what do they (eat|live on)|feed on/i,
    reply:
      "Both of them are mostly leaf eaters, and they take fruit, flowers and buds when those are around — which is why a mango tree or a jacaranda in flower gets so much traffic. Ringtails lean harder on leaves than brushtails do.",
  },
  {
    // neighbour.txt SPECIES ID — never conclusive; say which feature to look at, and
    // mention in passing that a frame can be sent for identification, without pushing it.
    key: "species",
    match: /(brushtail|ringtail)[^?.!]{0,12}or[^?.!]{0,12}(brushtail|ringtail)|which (one|species|kind)|what (kind|sort|species)|is (it|this)( one)? a (brushtail|ringtail)|identif|tell them apart/i,
    reply:
      "I won't call it either way from here. Have a look at the tail — bushy means brushtail, thin and curled at the tip means ringtail — and the ears will back that up. You can also send the frame for identification if you'd rather.",
  },
];

// Not one of the routes above. shared.txt HONESTY: if it does not know, it says so.
//
// This used to end "tell me about the tail — bushy, or thin and curled at the tip — and I can
// say which of the two it looks like", which is the question neighbour.txt prescribes for a
// possum. The trouble is what reaches a fallback: everything the routes missed. Ask about a
// taipan or a microbat — neither of which matched, before the two routes above were widened —
// and the answer was an offer to identify it from its tail. That is the one thing shared.txt
// says never to do, on the screen, at a public exhibit.
//
// Widening the lists helps and is not enough, because there will always be a name nobody
// listed. So the fallback stops offering identification at all. Nothing is lost: the species
// route already carries the tail question, and it only fires when somebody is actually asking
// about a possum.
const FALLBACK =
  "I've only got a few answers loaded in this prototype, so I'd be guessing at that one. I only cover brushtail and ringtail possums, and I won't try to identify anything else. If it's another animal and you're unsure about it, keep people and pets back and call the RSPCA on 1300 ANIMAL (1300 264 625) — they're on 7am to 7pm every day, and their site has the after-hours list.";

export function assistantReply(text) {
  const route = ROUTES.find((r) => r.match.test(String(text || "")));
  const reply = !route
    ? FALLBACK
    : route.script
      ? ASSISTANT_SCRIPT.find((s) => s.key === route.script).reply
      : route.reply;
  return { role: "neighbour", reply, prompt_version: PROMPT_VERSION };
}

// The same answer down the streaming path, shaped like the real proxy: the version in the
// first frame, deltas in between, done at the end.
export function assistantFrames(text) {
  const { reply } = assistantReply(text);
  return [
    { prompt_version: PROMPT_VERSION },
    ...(reply.match(/\S+\s*/g) || []).map((delta) => ({ delta })),
    { done: true },
  ];
}

// ── Offline dataset (only fixtures mode uses it; dead under hybrid) ──
// The status values are the real three: active | readonly | archived. The past the
// prototype wrote is not a status but the name of a dashboard group — two different
// things, and conflating them means the archived state never fires.
const STORYBOARDS = {
  sb_jacaranda: {
    id: "sb_jacaranda",
    title: "The one in the jacaranda",
    suburb: "Paddington",
    status: "active",
    level: "reshare",
    participants: ["mel_k", "dan_h", "aroha_t", "sione_f"],
    entry_count: 5,
    latest_species: "ringtail",
    last_entry_at: "2026-09-12T21:47:00+10:00",
  },
  sb_roof: {
    id: "sb_roof",
    title: "Roof thumper",
    suburb: "Annerley",
    status: "archived",
    level: "view",
    participants: ["mel_k", "dan_h"],
    entry_count: 3,
    latest_species: "brushtail",
    last_entry_at: "2026-08-02T23:12:00+10:00",
  },
};

// These arrays run oldest first: the order /api/timeline returns (ORDER BY created_at,
// rowid). They used to run newest first while the server ran oldest first, so live and
// offline showed users opposite timelines and "Show more" loaded opposite ends of the
// story; settled 2026-09-18 on the server's direction. submitEntry therefore appends.
const TIMELINES = {
  sb_jacaranda: [
    {
      id: "e1", handle: "mel_k", species: "ringtail", fun_fact: null,
      story: "Heard the gutter go and there she was, just sitting in the jacaranda looking at me while I filmed. Didn't move the whole time.",
      being_checked: 0, created_at: "2026-09-02T21:14:00+10:00",
    },
    {
      id: "e2", handle: "dan_h", species: "brushtail", fun_fact: null,
      story: "Pretty sure this is a different one, much bigger. Came over the back fence and went straight up the trunk without stopping.",
      being_checked: 0, created_at: "2026-09-05T22:30:00+10:00",
    },
    {
      id: "e3", handle: "aroha_t", species: "ringtail",
      fun_fact: "People often say they only eat leaves, though they take fruit and flowers too.",
      story: "two of them this time. one stayed right up the top and kept making that clicking noise the whole time, couldn't get both of them in frame",
      being_checked: 1, created_at: "2026-09-08T20:05:00+10:00",
    },
    {
      id: "e4", handle: "sione_f", species: "brushtail", fun_fact: null,
      story: "2am, roof, again. Caught him coming down the drainpipe on the side of the house. Absolutely unbothered by me standing there in my dressing gown.",
      being_checked: 0, created_at: "2026-09-10T02:18:00+10:00",
    },
    {
      id: "e5", handle: "mel_k", species: "ringtail",
      fun_fact: "Ringtails build nests called dreys and carry the material with their tail.",
      story: "Back again tonight. Went along the top of the fence, then sat in the jacaranda for ages pulling the flowers off the end of a branch.",
      being_checked: 0, created_at: "2026-09-12T21:47:00+10:00",
    },
  ],
  sb_roof: [
    {
      id: "r1", handle: "mel_k", species: "brushtail",
      fun_fact: "Brushtails den in tree hollows when they can get one, which is why a roof cavity suits them.",
      story: "Started this one because of the noise. Not much to see yet, but here he is on the way up.",
      being_checked: 0, created_at: "2026-07-25T22:55:00+10:00",
    },
    {
      id: "r2", handle: "mel_k", species: "brushtail", fun_fact: null,
      story: "Thumping right over the bedroom again. Filmed the gutter for five minutes and got about two seconds of him.",
      being_checked: 0, created_at: "2026-07-28T01:40:00+10:00",
    },
    {
      id: "r3", handle: "dan_h", species: "brushtail", fun_fact: null,
      story: "Last one from me. Roof's been quiet since the tree out the back got cut right down.",
      being_checked: 0, created_at: "2026-08-02T23:12:00+10:00",
    },
  ],
};

// A refusal has to be demonstrable too. The trigger is deterministic: the body carries this
// invented address. Only reason_codes come back — no verdict and no note, because the
// author never sees the internal judgement.
export const BLOCKED_TRIGGER = "42 Example St";

let entrySeq = 0;

export function myRecord() {
  // Offline "I" am mel_k, so this counts mel_k's entries across the fixture storyboards.
  const mine = Object.values(TIMELINES).flat().filter((e) => e.handle === "mel_k");
  const latest = mine.map((e) => e.created_at).sort().pop() || null;
  return { entries: mine.length, latest_at: latest,
           storyboards: Object.entries(TIMELINES)
             .filter(([, list]) => list.some((e) => e.handle === "mel_k")).length };
}

export function dashboard() {
  const all = Object.values(STORYBOARDS).map((b) => ({ ...b }));
  return {
    active: all.filter((b) => b.status === "active"),
    past: all.filter((b) => b.status !== "active"),
  };
}

// "What can I do here" in offline mode. Matches boardAccess in api.js.
export function boardAccess(id) {
  const board = STORYBOARDS[id];
  return { level: board?.level || null, status: board?.status || null };
}

// Matches TIMELINE_PAGE in proxy/app.py. Offline mode has to page the same way the server
// does or it is not standing in for the server — and the difference would only show up on a
// storyboard long enough to need a second page, which is exactly where nobody looks.
const PAGE = 20;

export function timeline(storyboardId, after) {
  const all = (TIMELINES[storyboardId] || []).map((e) => ({ ...e }));
  const at = after ? all.findIndex((e) => e.id === after) : -1;
  // The server answers 400 to a cursor this storyboard never issued, rather than starting
  // again at page one; findIndex's -1 used to do exactly that here. Offline has to refuse it
  // the same way or it is not standing in for the server.
  if (after && at === -1) {
    throw Object.assign(new Error("The assistant could not read that request."),
                        { status: 400, code: "bad_request" });
  }
  const start = at + 1;
  const page = all.slice(start, start + PAGE);
  return {
    storyboard_id: storyboardId,
    ...STORYBOARDS[storyboardId],
    entries: page,
    next: start + PAGE < all.length ? page[page.length - 1].id : null,
    // Counted over the whole list, not the page: the header says how many sightings there
    // are and what date the storyboard runs from, and neither is a fact about a page.
    sightings: all.length,
    // Worked out from the entries in the order they happened, first sighting first: the
    // server orders the header's names by MIN(created_at), and this array now runs oldest
    // first, so first appearance in the list is first appearance on the board. Rather than
    // the prototype's hand-written list on STORYBOARDS - which never changed, so a
    // storyboard made a moment ago showed a contributor with no sightings, and deleting
    // somebody's last one left their name up. Found by the pre-deploy review.
    participants: [...new Set(all.map((e) => e.handle))],
    // The first element rather than a sort of the stamps. These arrays run oldest first and
    // submitEntry appends, so the oldest is always at the front — and the fixture stamps
    // carry a +10:00 offset while a freshly posted one is written in Z, which a string sort
    // gets right only by accident.
    first_seen: all.length ? all[0].created_at : null,
  };
}

export function createStoryboard(title) {
  // A title is screened too since #36, and the offline demo has to be able to show it: the
  // title is the line everyone reads first, and an address sitting in one was the case the
  // change was made for.
  if (String(title || "").includes(BLOCKED_TRIGGER)) {
    return { published: false, reason_codes: ["pii"], prompt_version: PROMPT_VERSION };
  }
  const id = "sb_" + Math.random().toString(36).slice(2, 8);
  STORYBOARDS[id] = {
    id, title, suburb: "Brisbane", status: "active", level: "reshare",
    participants: ["mel_k"], entry_count: 0, latest_species: null,
    last_entry_at: new Date().toISOString(),
  };
  TIMELINES[id] = [];
  return { storyboard_id: id, title };
}

export function submitEntry(body) {
  if (String(body.story || "").includes(BLOCKED_TRIGGER)) {
    return { published: false, reason_codes: ["pii"], prompt_version: PROMPT_VERSION };
  }
  entrySeq += 1;
  const entry = {
    id: "e_new_" + entrySeq,
    handle: "mel_k",
    species: body.species,
    fun_fact: body.fun_fact || null,
    story: body.story,
    being_checked: 0,
    // Offset by the sequence number so two entries posted in the same millisecond do not
    // share a stamp. The server does not need this — it writes to the second and breaks ties
    // on rowid — but a fixture row has no rowid, so identical stamps leave this list with no
    // defined order at all. It surfaced as a test that could not tell a whole-storyboard
    // first_seen from a per-page one, because every row was stamped alike.
    created_at: new Date(Date.now() + entrySeq).toISOString(),
  };
  const list = TIMELINES[body.storyboard_id] || (TIMELINES[body.storyboard_id] = []);
  list.push(entry);
  const board = STORYBOARDS[body.storyboard_id];
  if (board) {
    board.entry_count = list.length;
    board.latest_species = entry.species;
    board.last_entry_at = entry.created_at;
  }
  return { entry_id: entry.id, published: true, prompt_version: PROMPT_VERSION };
}

// ── Discussion (offline dataset) ──
// Its own table, its own endpoints. The assistant cannot reach it, by design rather than
// by accident.
const FORUM = {
  sb_jacaranda: [
    {
      id: "t1", handle: "dan_h", title: "Anyone else's mango tree getting stripped?",
      created_at: "2026-09-11T19:22:00+10:00", post_count: 4,
      posts: [
        { id: "t1p0", handle: "dan_h", created_at: "2026-09-11T19:22:00+10:00",
          body: "Half the fruit is gone and what's left has bites out of it. Assuming it's the same one that's been on the fence, but I've never actually seen it in the tree." },
        { id: "t1p1", handle: "aroha_t", created_at: "2026-09-11T20:04:00+10:00",
          body: "Same here with the lillypilly. They go for the soft stuff first and leave the rest on the ground." },
        { id: "t1p2", handle: "mel_k", created_at: "2026-09-11T21:40:00+10:00",
          body: "Mine only started once the fruit got ripe. Netting helped but you have to get the edges right or they just walk under it." },
        { id: "t1p3", handle: "sione_f", created_at: "2026-09-12T08:15:00+10:00",
          body: "Picked the last of ours early this year and it was fine on the windowsill. Beat them to it basically." },
      ],
    },
    {
      id: "t2", handle: "sione_f", title: "What actually keeps them out of the roof?",
      created_at: "2026-09-09T22:10:00+10:00", post_count: 3,
      posts: [
        { id: "t2p0", handle: "sione_f", created_at: "2026-09-09T22:10:00+10:00",
          body: "Had one going up the drainpipe every night for a fortnight. Before I spend money on it — what worked for people here?" },
        { id: "t2p1", handle: "dan_h", created_at: "2026-09-10T07:35:00+10:00",
          body: "Sealing the gaps once it's out, and doing it at night when you know it's not in there. Ours came back for a week and gave up." },
        { id: "t2p2", handle: "mel_k", created_at: "2026-09-10T19:02:00+10:00",
          body: "Ours was the gap where the gutter meets the eave. Took a torch and a lot of squinting to find it." },
      ],
    },
  ],
  sb_roof: [],
};

let forumSeq = 0;

export function forumThreads(storyboardId) {
  const threads = (FORUM[storyboardId] || []).map(({ posts, ...rest }) => rest);
  return { storyboard_id: storyboardId, threads };
}

export function readThread(threadId, after) {
  for (const list of Object.values(FORUM)) {
    const thread = list.find((t) => t.id === threadId);
    if (!thread) continue;
    const all = thread.posts.map((p) => ({ ...p }));
    const at = after ? all.findIndex((p) => p.id === after) : -1;
    // The server answers 400 to a cursor this thread never issued rather than restarting at
    // page one; offline has to refuse it the same way to stand in for the server.
    if (after && at === -1) {
      throw Object.assign(new Error("The assistant could not read that request."),
                          { status: 400, code: "bad_request" });
    }
    const start = at + 1;
    const page = all.slice(start, start + PAGE);
    return {
      thread_id: threadId, title: thread.title, posts: page,
      next: start + PAGE < all.length ? page[page.length - 1].id : null,
    };
  }
  return { thread_id: threadId, posts: [], next: null };
}

export function removeEntry(entryId) {
  // Offline there is one person, so "the owner removed it" and "the author withdrew it"
  // land in the same place. What matters here is that the screen behaves the same way.
  for (const list of Object.values(TIMELINES)) {
    const at = list.findIndex((e) => e.id === entryId);
    if (at !== -1) {
      list.splice(at, 1);
      return { entry_id: entryId, removed: true };
    }
  }
  return { entry_id: entryId, removed: false };
}

export function deleteForumPost(postId) {
  // Offline mirror of the server rule: the post goes, and a thread with nothing left in it
  // goes with it. A thread that still holds a reply stays, title and all, because that
  // title is what the reply hangs on.
  for (const [boardId, list] of Object.entries(FORUM)) {
    for (const thread of list) {
      const at = thread.posts.findIndex((p) => p.id === postId);
      if (at === -1) continue;
      thread.posts.splice(at, 1);
      thread.post_count = thread.posts.length;
      if (thread.posts.length === 0) {
        FORUM[boardId] = list.filter((t) => t.id !== thread.id);
      }
      return { post_id: postId, deleted: true };
    }
  }
  return { post_id: postId, deleted: false };
}

export function createThread({ storyboardId, title, body }) {
  // A title has to be refusable too — the server now screens the title joined to the body,
  // so a clean body cannot rescue a title carrying an address. An offline demo that cannot
  // show this cannot show the point of that change.
  if (String(title || "").includes(BLOCKED_TRIGGER) || String(body || "").includes(BLOCKED_TRIGGER)) {
    return { published: false, reason_codes: ["pii"], prompt_version: PROMPT_VERSION };
  }
  forumSeq += 1;
  const id = "t_new_" + forumSeq;
  const now = new Date().toISOString();
  const thread = {
    id, handle: "mel_k", title, created_at: now, post_count: 1,
    posts: [{ id: id + "p0", handle: "mel_k", body, created_at: now }],
  };
  (FORUM[storyboardId] || (FORUM[storyboardId] = [])).unshift(thread);
  return { thread_id: id, post_id: thread.posts[0].id, published: true, prompt_version: PROMPT_VERSION };
}

export function createPost({ threadId, body }) {
  if (String(body || "").includes(BLOCKED_TRIGGER)) {
    return { published: false, reason_codes: ["pii"], prompt_version: PROMPT_VERSION };
  }
  for (const list of Object.values(FORUM)) {
    const thread = list.find((t) => t.id === threadId);
    if (!thread) continue;
    forumSeq += 1;
    const post = { id: "p_new_" + forumSeq, handle: "mel_k", body, created_at: new Date().toISOString() };
    thread.posts.push(post);
    thread.post_count = thread.posts.length;
    return { thread_id: threadId, post_id: post.id, published: true, prompt_version: PROMPT_VERSION };
  }
  return { thread_id: threadId, published: false, reason_codes: [], prompt_version: PROMPT_VERSION };
}

// Editing your own entry. Offline has to be able to show "edited and refused" as well; that
// is the outcome on this path that matters most.
export function editEntry({ entry_id, fun_fact, story }) {
  for (const [boardId, list] of Object.entries(TIMELINES)) {
    const entry = list.find((e) => e.id === entry_id);
    if (!entry) continue;
    const nextFact = fun_fact === undefined ? entry.fun_fact : fun_fact;
    const nextStory = story === undefined ? entry.story : story;
    if (String(nextFact || "").includes(BLOCKED_TRIGGER)
        || String(nextStory || "").includes(BLOCKED_TRIGGER)) {
      // On a refusal, not a character of the stored entry may change
      return { entry_id, published: false, reason_codes: ["pii"], prompt_version: PROMPT_VERSION };
    }
    if (nextFact === entry.fun_fact && nextStory === entry.story) {
      return { entry_id, published: true, unchanged: true };
    }
    entry.fun_fact = nextFact;
    entry.story = nextStory;
    return { entry_id, published: true, prompt_version: PROMPT_VERSION };
  }
  return { entry_id, published: false, reason_codes: [], prompt_version: PROMPT_VERSION };
}

export function deleteEntry(entryId) {
  for (const [boardId, list] of Object.entries(TIMELINES)) {
    const at = list.findIndex((e) => e.id === entryId);
    if (at < 0) continue;
    list.splice(at, 1);
    const board = STORYBOARDS[boardId];
    if (board) {
      board.entry_count = list.length;
      // The cover follows the most recent sighting: the last row of an oldest-first
      // list, mirroring the server's ORDER BY created_at DESC LIMIT 1.
      board.latest_species = list.at(-1)?.species ?? null;
    }
    return { entry_id: entryId, deleted: true };
  }
  return { entry_id: entryId, deleted: false };
}

// The offline second-look queue. It holds one entry written by somebody else and marked
// review, so this screen can be demonstrated at all. Note that no author identity appears
// here either — the same as the server query.
const QUEUE = {
  sb_jacaranda: [
    {
      entry_id: "e3",
      species: "ringtail",
      fun_fact: "Ringtails can live up to 40 years in the wild.",
      story: "Same one as last week I think, on the power line between the two poles.",
      created_at: "2026-09-09T20:12:00+10:00",
      fields: ["fun_fact"],
      codes: ["fact_conflict"],
      worth_checking: 0,
      looks_right: 0,
    },
  ],
};

export function reviewQueue(storyboardId) {
  return { storyboard_id: storyboardId, items: (QUEUE[storyboardId] || []).map((i) => ({ ...i })) };
}

export function disposeEntry(entryId, action) {
  for (const [boardId, list] of Object.entries(QUEUE)) {
    const at = list.findIndex((i) => i.entry_id === entryId);
    if (at < 0) continue;
    list.splice(at, 1);
    if (action === "removed") deleteEntry(entryId);
    return { entry_id: entryId, disposition: action };
  }
  return { entry_id: entryId, disposition: action };
}

// ── Review votes ──
export function castVote(entryId, vote) {
  for (const list of Object.values(QUEUE)) {
    const item = list.find((i) => i.entry_id === entryId);
    if (!item) continue;
    // One vote each, and offline there is only one person, so record a single vote. The
    // two-vote threshold (operations §2.2) is kept anyway, or offline shows nothing of
    // what happens once enough votes land.
    item[vote] += 1;
    if (item.worth_checking >= 2) disposeEntry(entryId, "labelled");
    else if (item.looks_right >= 2) disposeEntry(entryId, "kept");
    return { entry_id: entryId, worth_checking: item.worth_checking, looks_right: item.looks_right };
  }
  return { entry_id: entryId, worth_checking: vote === "worth_checking" ? 1 : 0,
           looks_right: vote === "looks_right" ? 1 : 0 };
}

// ── Sharing and access ──
const GRANTS = {
  sb_jacaranda: [
    { user_id: "u_mel", handle: "mel_k", level: "reshare", granted_at: "2026-08-28T10:00:00+10:00" },
    { user_id: "u_dan", handle: "dan_h", level: "reshare", granted_at: "2026-08-29T18:40:00+10:00" },
    { user_id: "u_aroha", handle: "aroha_t", level: "contribute", granted_at: "2026-09-02T09:15:00+10:00" },
    { user_id: "u_sione", handle: "sione_f", level: "contribute", granted_at: "2026-09-06T20:02:00+10:00" },
    { user_id: "u_priya", handle: "priya_r", level: "view", granted_at: "2026-09-11T12:30:00+10:00" },
  ],
  sb_roof: [
    { user_id: "u_mel", handle: "mel_k", level: "reshare", granted_at: "2026-07-25T22:00:00+10:00" },
  ],
};

export function closeStoryboard({ storyboard_id, closed_note }) {
  // A refused note leaves it open, exactly as the server does — archiving it anyway and
  // dropping the note would be the wrong half to keep.
  if (String(closed_note || "").includes(BLOCKED_TRIGGER)) {
    return { published: false, reason_codes: ["pii"], prompt_version: PROMPT_VERSION };
  }
  const board = STORYBOARDS[storyboard_id];
  if (board) {
    board.status = "archived";
    board.closed_note = closed_note || null;
  }
  return { storyboard_id, status: "archived", closed_note: closed_note || null };
}

// The offline code list. Note there is no token here either: as on the server, it is gone
// the moment it has been issued.
const LINKS = {
  sb_jacaranda: [
    // The live one, and the only one of the three that is. Its expiry is relative because a
    // written-down date stops being in the future: this one said 2026-09-19, and once the
    // clock passed it every code in the demo was dead and the share screen offered no Turn
    // off button at all. lib/fixtures.test.mjs holds the list to one of each state.
    { id: "sl_1", level: "contribute",
      expires_at: new Date(Date.now() + 5 * 86400000).toISOString(),
      max_uses: null, used_count: 2, revoked_at: null,
      created_by: "u_mel", created_by_handle: "mel_k" },
    { id: "sl_2", level: "view", expires_at: "2026-09-15T09:00:00+10:00",
      max_uses: 1, used_count: 1, revoked_at: null,
      created_by: "u_dan", created_by_handle: "dan_h" },
    { id: "sl_3", level: "reshare", expires_at: null,
      max_uses: null, used_count: 0, revoked_at: "2026-09-12T18:30:00+10:00",
      created_by: "u_mel", created_by_handle: "mel_k" },
  ],
};

export function shareLinks(storyboardId) {
  return {
    storyboard_id: storyboardId,
    owner_id: "u_mel",                 // the same owner as grants(), so the two cannot disagree
    links: (LINKS[storyboardId] || []).map((l) => ({ ...l })),
  };
}

export function revokeShareLink(shareLinkId) {
  for (const list of Object.values(LINKS)) {
    const link = list.find((l) => l.id === shareLinkId);
    if (!link) continue;
    // What is turned off is the code, not access already redeemed. GRANTS is untouched.
    link.revoked_at = new Date().toISOString();
    return { share_link_id: shareLinkId, revoked: true };
  }
  return { share_link_id: shareLinkId, revoked: false };
}

export function grants(storyboardId) {
  return { storyboard_id: storyboardId, owner_id: "u_mel",
           grants: (GRANTS[storyboardId] || []).map((g) => ({ ...g })) };
}

export function revokeGrant({ storyboardId, userId }) {
  GRANTS[storyboardId] = (GRANTS[storyboardId] || []).filter((g) => g.user_id !== userId);
  return { storyboard_id: storyboardId, user_id: userId, revoked: true };
}

export function issueShareLink({ storyboardId, level, expiresInDays }) {
  const days = expiresInDays || DEFAULT_EXPIRY_DAYS;
  const id = "sl_" + Math.random().toString(36).slice(2, 8);
  const expires_at = new Date(Date.now() + days * 86400000).toISOString();
  // The share screen loads the code list again as soon as a code is issued, so a code that
  // is not kept here is made and then missing from the list directly underneath it, which
  // reads as the product losing it. Every other offline mutation already persists: turning
  // a code off, revoking a grant, starting a thread, replying to one. This was the one that
  // did not. Newest first, because the server lists them ORDER BY rowid DESC.
  (LINKS[storyboardId] || (LINKS[storyboardId] = [])).unshift({
    id, level, expires_at, max_uses: null, used_count: 0, revoked_at: null,
    created_by: "u_mel", created_by_handle: "mel_k",   // whoever "I" am offline, as elsewhere
  });
  return {
    share_link_id: id,
    token: "fixture-" + Math.random().toString(36).slice(2, 14),
    level,
    expires_at,
    max_uses: null,
  };
}

export function redeemShareLink(token) {
  if (String(token).startsWith("fixture-")) return { storyboard_id: "sb_jacaranda", level: "contribute" };
  const error = new Error("This link doesn't work.");
  error.status = 404;
  throw error;
}
