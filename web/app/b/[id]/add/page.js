"use client";

// 2 · Capture

import { use } from "react";
import { useRouter } from "next/navigation";
import { COPY } from "../../../../lib/copy";
import { BackButton, Steps, ui } from "../../../../components/ui";
import styles from "./add.module.css";

export default function Capture({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const next = () => router.push(`/b/${id}/add/frame`);

  return (
    <div className={ui.screen}>
      <div className={ui.bar}>
        <BackButton onClick={() => router.push(`/b/${id}`)} />
      </div>
      <Steps at={0} />

      <div className={ui.body}>
        <h1 className={ui.h1} style={{ fontSize: 28 }}>Add a sighting</h1>
        <p className={ui.lede}>{COPY.captureLede}</p>

        <button type="button" className={styles.bigPrimary} onClick={next}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 10l5-3v10l-5-3z" /><rect x="2" y="6" width="13" height="12" rx="3" />
          </svg>
          Record
        </button>
        <button type="button" className={styles.bigQuiet} onClick={next}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <path d="M3 15l4.5-4.5 5 5M14 13l2.5-2.5L21 15" />
          </svg>
          Choose from library
        </button>

        <p className={styles.footnote}>{COPY.noCameras}</p>
      </div>
    </div>
  );
}
