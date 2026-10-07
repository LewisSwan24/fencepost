"use client";

// The controls behind /study. Everything it shows comes from lib/study.js, which keeps the
// session in this browser's storage and sends nothing anywhere; the file exported here is
// the only copy that ever leaves the device.

import { useEffect, useState } from "react";
import { assistantIsLive } from "../../lib/api";
import { COPY } from "../../lib/copy";
import { endStudy, startStudy, storageWorks, studyExport, studyFileName, studyRecord,
         STUDY_KEY } from "../../lib/study";
import { ui } from "../../components/ui";
import styles from "./study.module.css";

function clock(iso) {
  return new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

function download(record) {
  const blob = new Blob([studyExport(record)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = studyFileName(record);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function Study() {
  // Read after mount, not during render: this page is also rendered on the server, where
  // there is no storage, and the two renders have to agree.
  const [ready, setReady] = useState(false);
  const [record, setRecord] = useState(null);
  const [canStore, setCanStore] = useState(true);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setRecord(studyRecord());
    setCanStore(storageWorks());
    setReady(true);
    // The participant may be asking in another tab of this browser; keep the counts current.
    const refresh = (e) => { if (e.key === null || e.key === STUDY_KEY) setRecord(studyRecord()); };
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);

  function start() {
    setRecord(startStudy());
    if (!studyRecord()) setCanStore(false);
  }

  function end() {
    endStudy();
    setRecord(studyRecord());
    setConfirming(false);
  }

  let body = null;
  if (!ready) {
    body = null;
  } else if (assistantIsLive) {
    body = <p className={styles.note}>{COPY.studyLive}</p>;
  } else if (!canStore) {
    body = <p className={styles.note} role="alert">{COPY.studyNoStorage}</p>;
  } else if (!record) {
    body = (
      <>
        <p className={styles.note}>{COPY.studyTell}</p>
        <button type="button" className={ui.btn} onClick={start}>{COPY.studyStart}</button>
      </>
    );
  } else {
    body = (
      <>
        <p className={styles.status}>{COPY.studyOn(clock(record.started_at))}</p>
        <p className={styles.counts}>{COPY.studyCounts(record.routed, record.misses.length)}</p>
        {record.misses.length ? (
          <ol className={styles.list}>
            {record.misses.map((m, i) => (
              <li key={i} className={styles.item}>
                <span className={styles.time}>{clock(m.at)}</span>
                <span className={styles.question}>{m.question}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.note}>{COPY.studyNoMisses}</p>
        )}
        <div className={styles.actions}>
          <button type="button" className={ui.btn} onClick={() => download(record)}>
            {COPY.studyExport}
          </button>
          {confirming ? (
            <div className={styles.confirm} role="group" aria-label={COPY.studyEnd}>
              <p className={styles.note}>{COPY.studyEndConfirm}</p>
              <button type="button" className={ui.btn} onClick={end}>{COPY.studyEndYes}</button>
              <button type="button" className={ui.btnQuiet} onClick={() => setConfirming(false)}>
                {COPY.studyEndNo}
              </button>
            </div>
          ) : (
            <button type="button" className={ui.btnQuiet} onClick={() => setConfirming(true)}>
              {COPY.studyEnd}
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <main className={styles.page}>
      <a className={styles.back} href="/">← Fencepost</a>
      <h1 className={styles.title}>{COPY.studyTitle}</h1>
      <p className={styles.lede}>{COPY.studyLede}</p>
      {body}
    </main>
  );
}
