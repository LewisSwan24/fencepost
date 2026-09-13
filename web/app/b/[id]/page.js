"use client";

// 故事版时间线。第一期里它是投稿之后落地的地方；
// Being checked 的公开标签和投票在第二期加（issue #23-B）。

import { use, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { storyboard, isArchived } from "../../../lib/api";
import { SPECIES_LABEL } from "../../../lib/fixtures";
import { COPY } from "../../../lib/copy";
import { stamp, countLabel } from "../../../lib/format";
import { BackButton, ui } from "../../../components/ui";
import styles from "./page.module.css";

export default function Storyboard({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const justPosted = useSearchParams().get("posted");
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(Boolean(justPosted));

  useEffect(() => {
    storyboard(id).then(setView, (e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(false), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const archived = view ? isArchived(view.status) : false;
  const entries = view?.entries || [];

  return (
    <div className={ui.screen}>
      <div className={ui.bar}>
        <BackButton onClick={() => router.push("/")} label="All storyboards" />
        <span className={ui.barTitle}>{view?.title || ""}</span>
      </div>

      <div className={ui.body}>
        {error ? <p style={{ color: "var(--text-dim)" }}>{error}</p> : null}
        {!view && !error ? <p style={{ color: "var(--text-dim)" }}>Loading…</p> : null}

        {view ? (
          <>
            <div className={styles.cover} />
            <h1 className={styles.title}>{view.title}</h1>
            <div className={styles.meta}>
              {view.suburb ? <><span>{view.suburb}</span><span className={styles.dot} /></> : null}
              <span>{countLabel(entries.length, "sighting", "sightings")}</span>
            </div>
            {view.participants ? (
              <div className={styles.people}>
                {view.participants.map((h) => <span key={h} className={styles.who}>@{h}</span>)}
              </div>
            ) : null}

            {archived ? <p className={styles.banner}>{COPY.archived}</p> : null}

            <div className={styles.rule} />

            {entries.length === 0 ? (
              <p style={{ color: "var(--text-dim)" }}>Nothing here yet. Yours would be the first.</p>
            ) : (
              entries.map((e) => (
                <article key={e.id}
                         className={[styles.entry, e.id === justPosted ? styles.entryNew : ""].join(" ")}>
                  <div className={styles.entryHead}>
                    <span className={styles.handle}>@{e.handle}</span>
                    <span className={styles.dot} />
                    <span className={styles.when}>{stamp(e.created_at)}</span>
                    <span className={styles.species}>{SPECIES_LABEL[e.species] || "Not sure"}</span>
                  </div>
                  <div className={styles.shot} />
                  {e.fun_fact ? (
                    <div className={styles.fact}>
                      <div className={styles.factKicker}>Fun fact</div>
                      <div className={styles.factText}>{e.fun_fact}</div>
                    </div>
                  ) : null}
                  <p className={styles.story}>{e.story}</p>
                </article>
              ))
            )}
          </>
        ) : null}
      </div>

      {view && !archived ? (
        <div className={[ui.footer, ui.footerSticky].join(" ")}>
          <button type="button" className={ui.btn} onClick={() => router.push(`/b/${id}/add`)}>
            {COPY.addSighting}
          </button>
        </div>
      ) : null}

      {toast ? <div className={styles.toast}>{COPY.posted}</div> : null}
    </div>
  );
}
