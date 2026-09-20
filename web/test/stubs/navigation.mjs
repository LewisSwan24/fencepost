// next/navigation, as far as these screens use it.
//
// Only two hooks are reached for across the whole interface — useRouter (32 call sites) and
// useSearchParams (4) — and of the router only push and replace are ever called. So the stub
// is small, and where a screen sends you is recorded rather than performed: `navigated` is
// the list of ["push", "/you"] pairs since the last reset.
//
// Recording rather than navigating is the point. "Signing in takes you to /you" is a claim a
// test can make about this list; it is not a claim anybody can make about a real router
// inside jsdom, which would either do nothing or unload the document.

export const navigated = [];

let search = new URLSearchParams();

const router = {
  push: (url) => navigated.push(["push", url]),
  replace: (url) => navigated.push(["replace", url]),
  back: () => navigated.push(["back"]),
  forward: () => navigated.push(["forward"]),
  refresh: () => navigated.push(["refresh"]),
  prefetch: () => Promise.resolve(),
};

export function useRouter() {
  return router;
}

export function useSearchParams() {
  return search;
}

// Call between tests. A leftover entry from the previous test is the kind of thing that makes
// a suite pass in one order and fail in another.
export function reset({ query = "" } = {}) {
  navigated.length = 0;
  search = new URLSearchParams(query);
}
