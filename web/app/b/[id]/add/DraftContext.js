"use client";

// The posting flow spans five routes, so the draft has to live in a layout above them.
// This provider is the price of real routes; what it buys is that the back button, a
// refresh and a shared link all behave as expected.

import { createContext, useContext, useMemo, useState } from "react";
import { CLIP } from "../../../../lib/fixtures";

const DraftContext = createContext(null);

export function DraftProvider({ storyboardId, children }) {
  const [frameIndex, setFrameIndexRaw] = useState(CLIP.default_index);
  const [stills, setStillsRaw] = useState([]);       // real frames out of the user's clip, empty until one is picked
  const [cover, setCover] = useState(null);          // the masked frame that goes with the entry
  const [boxes, setBoxes] = useState([]);
  const [suggestion, setSuggestion] = useState(null); // the frame-identification sentence, null until sent
  const [species, setSpecies] = useState(null);       // always chosen by the user, never preselected
  const [funFact, setFunFact] = useState("");
  const [story, setStory] = useState("");

  // Stills and the chosen index move together. The index starts at CLIP.default_index,
  // which is 3 of 8 fixture positions; a clip that yielded fewer than four stills would
  // leave it pointing past the end, and the frame screen would render undefined. The
  // functional update keeps this out of the memo's dependency list.
  // A box belongs to the picture it was drawn over, and to no other.
  //
  // Boxes are stored as percentages of the on-screen canvas and redact() burns them in as
  // percentages of whatever image it is given, so a box that outlives its frame does not
  // disappear — it lands at the same coordinates on a different picture. Somebody covers a
  // neighbour's face on frame 3, goes back, scrubs to frame 6 where that neighbour has moved,
  // and the rectangle now blacks out a patch of fence while the face goes out uncovered. The
  // masking screen's gate is already satisfied, so they are never asked about the new frame at
  // all. Found by an adversarial review on 2026-09-17.
  //
  // So both ways of changing which picture is being masked clear the boxes with them.
  function setStills(list) {
    const safe = Array.isArray(list) ? list : [];
    setStillsRaw(safe);
    setBoxes([]);
    if (safe.length) setFrameIndexRaw((i) => Math.min(i, safe.length - 1));
  }

  // Plain setState calls, not an updater that also writes other state: updaters have to be
  // pure and StrictMode invokes them twice to prove it, which is what once left every drag on
  // the masking screen with two boxes stacked exactly on top of each other. Both call sites
  // pass an absolute index, so nothing is lost by not reading the previous one.
  function setFrameIndex(next) {
    setFrameIndexRaw(next);
    setBoxes([]);
  }

  const value = useMemo(
    () => ({
      storyboardId,
      frameIndex, setFrameIndex,
      stills, setStills,
      cover, setCover,
      boxes, setBoxes,
      suggestion, setSuggestion,
      species, setSpecies,
      funFact, setFunFact,
      story, setStory,
    }),
    [storyboardId, frameIndex, stills, cover, boxes, suggestion, species, funFact, story]
  );

  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useDraft() {
  const draft = useContext(DraftContext);
  if (!draft) throw new Error("useDraft is only usable inside the posting flow");
  return draft;
}
