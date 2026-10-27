// The booth screen's window onto one Fencepost storyboard.
//
// The screen is a member of the booth storyboard at the view level, like anybody else who
// redeemed a link, and reads it through the same GET /api/timeline. Two things are different
// because the screen is public:
//
//   The token stays on this server. It is read from server-only variables, never from a
//   NEXT_PUBLIC_ one, so it is not in any bundle and the browser only ever talks to this
//   route. That also keeps the kiosk same-origin, so the API's CORS list is not touched.
//
//   Authors are not named. Entries go out with species, fun fact, story, still and time;
//   author_id and handle are dropped here, before anything reaches the page.
//
// Nothing is cached, here or downstream: an entry its author deleted must leave the screen
// on the next poll ("soft deletes take effect immediately"). Any failure is a 502 with no
// entries, and the page clears what it was showing rather than keeping it.

export const BOOTH_LIMIT = 12;
// The timeline pages oldest first, 20 a page, and the newest are on the last page. A booth
// storyboard runs for one day; past this many pages something is wrong, and an error is
// better than showing the oldest entries as though they were the latest.
const MAX_PAGES = 25;
const TIMEOUT_MS = 8000;
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

const json = (status, body) =>
  Response.json(body, { status, headers: NO_STORE });

function settings(env) {
  const token = env.FENCEPOST_BOOTH_TOKEN;
  const storyboard = env.FENCEPOST_BOOTH_STORYBOARD;
  const api = env.FENCEPOST_API || env.NEXT_PUBLIC_FENCEPOST_API;
  if (!token || !storyboard || !api) return null;
  return { token, storyboard, api: api.replace(/\/+$/, "") };
}

export const publicEntry = (row) => ({
  id: row.id,
  species: row.species,
  fun_fact: row.fun_fact || "",
  story: row.story || "",
  still: row.still || null,
  created_at: row.created_at,
});

async function readAll({ token, storyboard, api }, fetchImpl) {
  const entries = [];
  let after = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ storyboard_id: storyboard });
    if (after) query.set("after", after);
    const response = await fetchImpl(`${api}/api/timeline?${query}`, {
      headers: { authorization: "Bearer " + token },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw Error("timeline " + response.status);
    const body = await response.json();
    if (!Array.isArray(body.entries)) throw Error("timeline shape");
    entries.push(...body.entries);
    if (!body.next) return entries;
    after = body.next;
  }
  throw Error("timeline too long");
}

export async function handleBoothFeed({
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const config = settings(env);
  if (!config) return json(503, { error: "booth_not_configured" });
  try {
    const entries = await readAll(config, fetchImpl);
    // Oldest first from the API; the screen leads with the newest.
    const latest = entries.slice(-BOOTH_LIMIT).reverse().map(publicEntry);
    return json(200, { entries: latest });
  } catch {
    // Nothing from upstream is passed on: not its status text, not its body.
    return json(502, { error: "booth_unavailable" });
  }
}
