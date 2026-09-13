"use client";

// 投稿流跨了五个路由，草稿得活在它们上面的 layout 里。
// 真路由的代价就是这个 provider；换来的是返回键、刷新和分享链接都按预期工作。

import { createContext, useContext, useMemo, useState } from "react";
import { CLIP } from "../../../../lib/fixtures";

const DraftContext = createContext(null);

export function DraftProvider({ storyboardId, children }) {
  const [frameIndex, setFrameIndex] = useState(CLIP.default_index);
  const [boxes, setBoxes] = useState([]);
  const [suggestion, setSuggestion] = useState(null); // 认帧回来的那句话，没送过就是 null
  const [species, setSpecies] = useState(null);       // 永远由用户点出来，不预选
  const [funFact, setFunFact] = useState("");
  const [story, setStory] = useState("");

  const value = useMemo(
    () => ({
      storyboardId,
      frameIndex, setFrameIndex,
      boxes, setBoxes,
      suggestion, setSuggestion,
      species, setSpecies,
      funFact, setFunFact,
      story, setStory,
    }),
    [storyboardId, frameIndex, boxes, suggestion, species, funFact, story]
  );

  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useDraft() {
  const draft = useContext(DraftContext);
  if (!draft) throw new Error("useDraft 只能在投稿流里用");
  return draft;
}
