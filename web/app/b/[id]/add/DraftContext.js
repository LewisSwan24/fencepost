"use client";

// The posting flow spans five routes, so the draft has to live in a layout above them.
// This provider is the price of real routes; what it buys is that the back button, a
// refresh and a shared link all behave as expected.

import { createContext, useContext, useMemo, useState } from "react";
import { CLIP } from "../../../../lib/fixtures";

const DraftContext = createContext(null);

export function DraftProvider({ storyboardId, children }) {
  const [frameIndex, setFrameIndex] = useState(CLIP.default_index);
  const [stills, setStillsRaw] = useState([]);       // real frames out of the user's clip, empty until one is picked
  const [boxes, setBoxes] = useState([]);
  const [suggestion, setSuggestion] = useState(null); // the frame-identification sentence, null until sent
  const [species, setSpecies] = useState(null);       // always chosen by the user, never preselected
  const [funFact, setFunFact] = useState("");
  const [story, setStory] = useState("");

  // Stills and the chosen index move together. The index starts at CLIP.default_index,
  // which is 3 of 8 fixture positions; a clip that yielded fewer than four stills would
  // leave it pointing past the end, and the frame screen would render undefined. The
  // functional update keeps this out of the memo's dependency list.
  function setStills(list) {
    const safe = Array.isArray(list) ? list : [];
    setStillsRaw(safe);
    if (safe.length) setFrameIndex((i) => Math.min(i, safe.length - 1));
  }

  const value = useMemo(
    () => ({
      storyboardId,
      frameIndex, setFrameIndex,
      stills, setStills,
      boxes, setBoxes,
      suggestion, setSuggestion,
      species, setSpecies,
      funFact, setFunFact,
      story, setStory,
    }),
    [storyboardId, frameIndex, stills, boxes, suggestion, species, funFact, story]
  );

  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useDraft() {
  const draft = useContext(DraftContext);
  if (!draft) throw new Error("useDraft is only usable inside the posting flow");
  return draft;
}
