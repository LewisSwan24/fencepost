"use client";

// 7 · Write it up, plus the writing panel.
//
// Three things that must not break: a candidate fun fact never enters the text by itself
// (only the button does that); the tidied version sits alongside the original rather than
// over it, and replacing takes a press; and neither verdict nor note appears in the panel.

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SPECIES_LABEL } from "../../../../../lib/fixtures";
import { COPY } from "../../../../../lib/copy";
import { submitEntry, writerHelp } from "../../../../../lib/api";
import { BackButton, Sheet, Spinner, Steps, ui } from "../../../../../components/ui";
import { useDraft } from "../DraftContext";
import styles from "./write.module.css";

export default function WriteItUp({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const draft = useDraft();
  const [helperOpen, setHelperOpen] = useState(false);
  const [helper, setHelper] = useState(null);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState(null);

  async function openHelper() {
    setHelperOpen(true);
    if (helper) return;
    setLoading(true);
    try {
      setHelper(await writerHelp(draft.species, draft.story));
    } catch (e) {
      setError(e.message);
      setHelperOpen(false);
    }
    setLoading(false);
  }

  async function post() {
    setPosting(true);
    setError(null);
    try {
      const result = await submitEntry({
        storyboardId: id,
        species: draft.species,
        funFact: draft.funFact.trim(),
        story: draft.story.trim(),
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

  const candidates = helper?.fun_facts || [];

  return (
    <div className={ui.screen}>
      <div className={ui.bar}>
        <BackButton onClick={() => router.push(`/b/${id}/add/species`)} />
      </div>
      <Steps at={4} />

      <div className={ui.body}>
        <div className={styles.head}>
          <div>
            <h1 className={ui.h1} style={{ margin: 0, fontSize: 24 }}>Write it up</h1>
            <div className={styles.chosen}>{SPECIES_LABEL[draft.species]}</div>
          </div>
        </div>

        <div className={styles.field}>
          <div className={styles.labelRow}>
            <label htmlFor="fun-fact">Fun fact</label>
            <span className={styles.optional}>optional</span>
          </div>
          <textarea id="fun-fact" className={styles.input} rows={3}
                    placeholder="Something true about this one"
                    value={draft.funFact}
                    onChange={(e) => draft.setFunFact(e.target.value)} />
        </div>

        <div className={styles.field}>
          <label htmlFor="story" className={styles.label}>What happened</label>
          <textarea id="story" className={styles.input} rows={6}
                    placeholder="What you saw, in your own words"
                    value={draft.story}
                    onChange={(e) => { draft.setStory(e.target.value); setHelper(null); }} />
        </div>

        {error ? <p className={styles.error}>{error}</p> : null}
      </div>

      <div className={ui.footer}>
        <button type="button" className={styles.helperOpen} onClick={openHelper}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-hover)"
               strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 19h16M7 15l3.5-9 3.5 9M8.4 12.6h4.2" /><path d="M17 6v5M19.5 8.5h-5" />
          </svg>
          {COPY.helperOpen}
        </button>
        <button type="button" className={ui.btn} disabled={!draft.story.trim() || posting}
                onClick={post}>
          {posting ? "Posting…" : COPY.post}
        </button>
      </div>

      {helperOpen ? (
        <Sheet onClose={() => setHelperOpen(false)} labelledBy="helper-title">
          <h2 id="helper-title" className={ui.sheetTitle} style={{ fontSize: 16, marginBottom: 4 }}>
            Possum Help
          </h2>
          <p className={styles.disclosure}>{COPY.helperDisclosure}</p>

          {loading ? <Spinner label="Working" /> : null}

          {helper && !loading ? (
            <>
              <div className={ui.kicker} style={{ marginTop: 18 }}>Fun facts you could use</div>
              {candidates.length === 0 ? (
                <p className={styles.note}>{COPY.helperEmpty}</p>
              ) : (
                candidates.map((c) => (
                  <div key={c.text} className={styles.candidate}>
                    <p className={styles.candidateText}>{c.text}</p>
                    <div className={styles.candidateFoot}>
                      <span className={[styles.tag,
                                        c.confidence === "established" ? styles.tagFirm : styles.tagSoft].join(" ")}>
                        {c.confidence === "established" ? "Established" : "Unverified"}
                      </span>
                      <button type="button" className={styles.add}
                              onClick={() => {
                                // Only a press puts it into the text. Opening the panel changes nothing.
                                const now = draft.funFact.trim();
                                draft.setFunFact(now ? now + " " + c.text : c.text);
                                setHelperOpen(false);
                              }}>
                        {COPY.addFact}
                      </button>
                    </div>
                  </div>
                ))
              )}

              <div className={ui.kicker}>Your story</div>
              {helper.question ? <p className={styles.note}>{helper.question}</p> : null}
              {helper.tidied_story ? (
                <>
                  <div className={styles.compare}>
                    <div className={styles.pane}>
                      <div className={styles.paneKicker}>As written</div>
                      <p className={styles.paneText}>{draft.story}</p>
                    </div>
                    <div className={[styles.pane, styles.paneTidied].join(" ")}>
                      <div className={[styles.paneKicker, styles.paneKickerTidied].join(" ")}>Tidied</div>
                      <p className={styles.paneText}>{helper.tidied_story}</p>
                    </div>
                  </div>
                  <button type="button" className={ui.btnQuiet} style={{ marginTop: 10 }}
                          onClick={() => {
                            draft.setStory(helper.tidied_story);
                            setHelperOpen(false);
                          }}>
                    {COPY.useTidied}
                  </button>
                </>
              ) : null}
              <p className={styles.version}>prompt_version {helper.prompt_version}</p>
            </>
          ) : null}
        </Sheet>
      ) : null}
    </div>
  );
}
