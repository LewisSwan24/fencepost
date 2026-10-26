"use client";

// Write and submit the author’s own observation.

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SPECIES_LABEL } from "../../../../../lib/fixtures";
import { COPY } from "../../../../../lib/copy";
import { submitEntry } from "../../../../../lib/api";
import { BackButton, ErrorNote, Steps, ui } from "../../../../../components/ui";
import { useDraft } from "../DraftContext";
import styles from "./write.module.css";

export default function WriteItUp({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const draft = useDraft();
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState(null);

  async function post() {
    setPosting(true);
    setError(null);
    try {
      const result = await submitEntry({
        storyboardId: id,
        species: draft.species,
        funFact: draft.funFact.trim(),
        story: draft.story.trim(),
        still: draft.cover, // the masked frame; undefined on the placeholder path
      });
      if (result.published) {
        router.push(`/b/${id}?posted=${encodeURIComponent(result.entry_id)}`);
      } else {
        const codes = (result.reason_codes || []).join(",");
        router.push(`/b/${id}/add/blocked?codes=${encodeURIComponent(codes)}`);
      }
    } catch (e) {
      setError(e.message);
      setPosting(false);
    }
  }

  // Deep-linking here (or refreshing) leaves the draft empty: with no species a submission
  // goes out carrying null and takes a 400, and the blocked screen would then say "your
  // writing is still there" when it is not. Go back and walk it again.
  useEffect(() => {
    if (!draft.species) router.replace(`/b/${id}/add/species`);
  }, [draft.species, id, router]);

  if (!draft.species) return null;

  return (
    <div className={ui.screen}>
      <div className={ui.bar}>
        <BackButton onClick={() => router.push(`/b/${id}/add/species`)} />
      </div>
      <Steps at={4} />

      <div className={ui.body}>
        <div className={styles.head}>
          <div>
            <h1 className={ui.h1} style={{ margin: 0, fontSize: 24 }}>
              Write it up
            </h1>
            <div className={styles.chosen}>{SPECIES_LABEL[draft.species]}</div>
          </div>
        </div>

        <div className={styles.field}>
          <div className={styles.labelRow}>
            <label htmlFor="fun-fact">Fun fact</label>
            <span className={styles.optional}>optional</span>
          </div>
          {/* The server caps these at FUN_FACT_LIMIT and STORY_LIMIT. Capping here too
              stops somebody typing past a limit they cannot see and meeting a 400 that
              says nothing useful. */}
          <textarea
            id="fun-fact"
            className={styles.input}
            rows={3}
            maxLength={500}
            placeholder="Something true about this one"
            value={draft.funFact}
            onChange={(e) => draft.setFunFact(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="story" className={styles.label}>
            What happened
          </label>
          <textarea
            id="story"
            className={styles.input}
            rows={6}
            maxLength={4000}
            placeholder="What you saw, in your own words"
            value={draft.story}
            onChange={(e) => draft.setStory(e.target.value)}
          />
        </div>

        <ErrorNote className={styles.error}>{error}</ErrorNote>
      </div>

      <div className={ui.footer}>
        <button
          type="button"
          className={ui.btn}
          disabled={!draft.story.trim() || posting}
          onClick={post}
        >
          {posting ? "Posting…" : COPY.post}
        </button>
      </div>
    </div>
  );
}
