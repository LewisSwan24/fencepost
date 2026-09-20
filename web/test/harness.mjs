// What every screen test needs before it can render anything.
//
// Two things the real app supplies that a test has to supply itself.
//
//   `params`. Next 15 hands a route's params to the page as a promise, and the pages read it
//   with React's `use`, which suspends the first time even on a promise that has already
//   settled. So a screen is always rendered inside a Suspense boundary and always awaited.
//
//   The draft. The five posting screens are one flow over five routes, and what is being
//   written lives in a provider above them. A test that wants to open the species screen with
//   a suggestion already in hand cannot get there through the interface, so `seed` runs once
//   inside the provider, from an effect, before the screen renders. From an effect rather than
//   during render because setting a provider's state while another component renders is the
//   exact fault DraftContext's own comments are about.

import { Suspense, useEffect, useState } from "react";
import { act, render, screen } from "@testing-library/react";

import { DraftProvider, useDraft } from "../app/b/[id]/add/DraftContext.js";

function Seed({ apply, children }) {
  const draft = useDraft();
  const [ready, setReady] = useState(!apply);
  useEffect(() => {
    if (!apply) return;
    apply(draft);
    setReady(true);
    // Once, on mount. Re-running on every draft change would put back whatever the test had
    // just changed through the interface.
  }, []);
  return ready ? children : null;
}

// The render itself goes inside an awaited act(), because a screen that suspends does not
// come back within the synchronous act() that render() uses on its own — React says so, and
// the body stays empty. Both helpers then wait for the screen's own h1, so a caller never
// starts asserting against a fallback.
async function mount(tree) {
  await act(async () => { render(tree); });
  return screen.findByRole("heading", { level: 1 });
}

// Render a page the way its route would, and wait for it to be there.
export function renderScreen(Page, { id = "sb_1", props = {} } = {}) {
  return mount(
    <Suspense fallback={null}>
      <Page params={Promise.resolve({ id })} {...props} />
    </Suspense>
  );
}

// The same, inside the posting flow, with the draft seeded first.
export function renderInFlow(Page, { id = "sb_1", seed, props = {} } = {}) {
  return mount(
    <DraftProvider storyboardId={id}>
      <Seed apply={seed}>
        <Suspense fallback={null}>
          <Page params={Promise.resolve({ id })} {...props} />
        </Suspense>
      </Seed>
    </DraftProvider>
  );
}
