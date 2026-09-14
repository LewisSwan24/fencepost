// 14 · The link does not work.
//
// This screen can leak nothing: no title, no participants, nothing about what is inside,
// and no distinction between expired and revoked — the two have to look identical, or a
// dead link becomes a probe: try another token, and the difference in wording tells you
// that storyboard exists.
//
// It fetches nothing, so it is a static page and does not even need "use client".

import { COPY } from "../../lib/copy";
import styles from "./no-access.module.css";

export const metadata = { title: "Fencepost" };

export default function NoAccess() {
  return (
    <div className={styles.centred}>
      <span className={styles.mark} aria-hidden="true">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)"
             strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="10" width="16" height="11" rx="3" />
          <path d="M8 10V7a4 4 0 018 0" />
        </svg>
      </span>
      <h1 className={styles.title}>{COPY.noAccessTitle}</h1>
      <p className={styles.body}>{COPY.noAccessBody}</p>
    </div>
  );
}
