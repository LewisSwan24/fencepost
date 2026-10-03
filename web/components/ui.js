"use client";

import { useEffect, useRef } from "react";
import styles from "./ui.module.css";

export { styles as ui };

export function BackButton({ onClick, label = "Back" }) {
  return (
    <button type="button" className={styles.icon} onClick={onClick} aria-label={label}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
}

// The five-step progress bar. Writing the entry is step five.
export function Steps({ at }) {
  return (
    <div className={styles.steps}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={[styles.step, i < at ? styles.stepDone : "",
                                  i === at ? styles.stepOn : ""].join(" ")} />
      ))}
    </div>
  );
}

// A frame slot. In the prototype this was a draggable image placeholder; here it takes no
// real material, so a patch of night is enough, with the explanation above it — no real
// photographs, and no cartoon possum either.
export function Frame({ height = 200, label, children }) {
  return (
    <div className={styles.frame} style={{ height }}>
      {children}
      {label ? <span className={styles.frameNote}>{label}</span> : null}
    </div>
  );
}

export function Spinner({ label }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-dim)" }}>
      <span className={styles.spinner} />
      {label}
    </span>
  );
}

// An error that appears after something was tried. role="alert" is what makes it heard: as a
// plain paragraph a refused sign-in or a 429 changed nothing a screen reader reports (#45).
// Nothing to say draws nothing, since an empty alert region is still one.
export function ErrorNote({ className, children }) {
  return children ? <p className={className} role="alert">{children}</p> : null;
}

// Things that can take focus, used to keep Tab inside the dialog.
const FOCUSABLE = 'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])';

export function Sheet({ onClose, children, labelledBy }) {
  const box = useRef(null);
  const opener = useRef(null);

  useEffect(() => {
    opener.current = document.activeElement;
    // Focus goes to the panel itself rather than the first field inside it: this is a
    // phone-shaped interface, and auto-focusing a textarea throws the software keyboard up
    // over half the screen. The APG explicitly allows focusing the dialog container.
    box.current?.focus();
    return () => {
      // On close, focus returns to the control that opened it rather than being dropped on
      // <body>, leaving somebody to Tab from the top of the page again.
      const back = opener.current;
      if (back && document.contains(back)) back.focus();
    };
  }, []);

  function onKeyDown(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose?.();
      return;
    }
    if (event.key !== "Tab") return;
    // aria-modal="true" tells a screen reader that everything outside does not exist.
    // Without trapping Tab that statement is false — somebody Tabs straight out into the
    // half of the page just declared not to be there.
    const items = Array.from(box.current?.querySelectorAll(FOCUSABLE) || [])
      .filter((el) => !el.disabled && el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className={styles.sheetScrim} onClick={onClose} onKeyDown={onKeyDown}
         role="presentation">
      <div ref={box} tabIndex={-1} className={styles.sheet} role="dialog" aria-modal="true"
           aria-labelledby={labelledBy} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
