// Walking /api/timeline, which is paged (TIMELINE_PAGE in proxy/app.py, twenty entries).
//
// Two things the detail screen got wrong the day paging went in, both found by the pre-deploy
// review and neither foreseen:
//
//   After posting, the page lands on /b/<id>?posted=<entry_id> and loads page one. The
//   timeline runs oldest first, so on a storyboard with twenty or more sightings the one just
//   posted is on page two: "Added to the storyboard" appeared over a list that did not have it.
//
//   Editing or deleting reloads the list, and reloading meant page one. Somebody's own entries
//   are the newest, so on a long storyboard they sit past page one — exactly where the Edit
//   and Delete buttons are used. Save an edit and the list collapsed to twenty with the edited
//   entry gone from under them.
//
// So a reload has to be able to say "at least as much as was showing" and "until this one is
// there". That is fillTo. It is bounded, because a list is not a reason to fetch for ever.
//
// The list lives under `entries` for the timeline and `posts` for a forum thread — both are
// paged the same way behind the same 4.5 MB cap — so the array key is a parameter defaulting
// to "entries". The timeline calls omit it; the thread screen passes "posts".

export const MAX_EXTRA_PAGES = 10;

// One more page on the end, without repeating anything already held. A page fetched against a
// list that has since been refetched can overlap it — a delete shifts every later entry one
// place up — and a repeated entry is a repeated React key as well as a duplicate card.
export function appendPage(view, page, key = "entries") {
  const held = view?.[key] || [];
  const have = new Set(held.map((e) => e.id));
  const fresh = (page?.[key] || []).filter((e) => !have.has(e.id));
  return { ...view, ...page, [key]: [...held, ...fresh] };
}

// Follow the cursor until the list holds `atLeast` entries and, when `containing` is given,
// that entry — or until there is no next page, or MAX_EXTRA_PAGES more have been fetched.
// `fetchPage(after)` is timeline(id, after) or readThread(threadId, after); passed in so this
// stays free of the network and can be tested on its own.
export async function fillTo(first, fetchPage,
                             { atLeast = 0, containing = null, key = "entries" } = {}) {
  let view = first;
  for (let fetched = 0; fetched < MAX_EXTRA_PAGES && view?.next; fetched += 1) {
    const items = view[key] || [];
    const enough = items.length >= atLeast;
    const found = !containing || items.some((e) => e.id === containing);
    if (enough && found) break;
    view = appendPage(view, await fetchPage(view.next), key);
  }
  return view;
}
