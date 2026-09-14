"use client";

// 8b · The submission was stopped.
//
// All the author sees is the sentence the reason_codes map to. No verdict, no note,
// nothing that could be read as the system passing judgement on them. What they typed
// stays exactly as it was — the draft lives in the context on the add layout, so going
// back finds it there.

import { use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { COPY, reasonSentence } from "../../../../../lib/copy";
import { ui } from "../../../../../components/ui";
import styles from "./blocked.module.css";

export default function Blocked({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const codes = (useSearchParams().get("codes") || "").split(",").filter(Boolean);

  return (
    <div className={[ui.screen, styles.centred].join(" ")}>
      <span className={styles.mark} aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent-hover)"
             strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 8v5M12 16.5v.5" /><circle cx="12" cy="12" r="9" />
        </svg>
      </span>
      <h1 className={styles.title}>{COPY.blockedTitle}</h1>
      <p className={styles.reason}>{reasonSentence(codes)}</p>
      <p className={styles.kept}>{COPY.blockedKept}</p>
      <button type="button" className={ui.btn} style={{ marginTop: 32 }}
              onClick={() => router.push(`/b/${id}/add/write`)}>
        {COPY.backToEditing}
      </button>
    </div>
  );
}
