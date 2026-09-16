"use client";

// Asked once, on the first visit: what should we call you?
//
// Until now a visitor who did not want an account was guest_9d83a54f5a4ff8a1, and that name
// sat beside everything they wrote and in the list of who a storyboard is shared with —
// which is the screen this product is about. A street keeping a storyboard together should
// not read like a server log.
//
// WHY IT IS A GATE AND NOT A SETTING. Changing a handle makes you a different user on the
// server and your sightings do not come with you; the sign-in screen already says that
// about accounts, and it is just as true here. So the name has to be settled before there
// is anything to lose, which means before the first request — and the first request goes
// out from a page's own effect. Child effects run before the parent's, so checking in an
// effect while rendering children would let the dashboard mint a random name before this
// screen ever appeared. Hence: render nothing until the answer is known.
//
// That costs one frame of blank shell, on pages whose content arrives from the API after
// hydration anyway. It is deliberately not solved by reading storage during render, which
// would make the server and the client disagree about the first paint.
//
// IT MUST NEVER BE THE REASON THE SITE DOES NOT OPEN. Every path that is not "this browser
// has no name yet" renders the app, including every way of failing.

import { useEffect, useState } from "react";
import { chooseHandle, hasHandle, usesNetwork, visitorHandle } from "../lib/api";
import { SUFFIX, toHandle } from "../lib/handle";
import { COPY } from "../lib/copy";
import { ui } from "./ui";
import styles from "./NameGate.module.css";

export default function NameGate({ children }) {
  const [state, setState] = useState("checking");   // checking | asking | ready
  const [name, setName] = useState("");

  useEffect(() => {
    try {
      // Not in fixtures mode. There is no server there, ensureSession is never called and
      // the handle is never sent anywhere — me() answers from offlineIdentity(), which is
      // the fixture character mel_k. Asking for a name and then greeting somebody by a
      // different one is worse than not asking: it is the failure that looks like success.
      // The delivered mode is hybrid, where the name really is the identity.
      setState(!usesNetwork || hasHandle() ? "ready" : "asking");
    } catch {
      setState("ready");                            // never block the app on this
    }
  }, []);

  function keep(chosen) {
    try {
      // Null covers both "the name had nothing usable in it" and "this browser would not
      // keep it". Either way visitorHandle() takes over on the next request with the random
      // name, which is what everybody had until tonight — a worse name, not a broken one.
      if (chosen) chooseHandle(chosen);
      else visitorHandle();
    } catch { /* the app opens regardless */ }
    setState("ready");
  }

  if (state === "checking") return null;
  if (state === "ready") return children;

  // What they will actually be called. Shown as they type, because a handle is not quite
  // what they typed and the suffix is the part that would otherwise look like a mistake.
  // A fixed placeholder suffix here: the real one is drawn when the name is kept, and a
  // preview that reshuffled on every keystroke would read as instability.
  //
  // Its length comes from SUFFIX rather than being written out, so the preview cannot show
  // a shorter name than the one actually handed over. It was four x's against an
  // eight-character suffix for about an hour on 2026-09-16 — a small lie, but this screen's
  // whole job is to tell somebody what they are about to be called.
  const preview = toHandle(name, "x".repeat(SUFFIX));
  const ready = !!preview;

  return (
    <div className={ui.screen}>
      <div className={ui.body}>
        <h1 className={ui.h1} style={{ marginTop: 44 }}>{COPY.nameTitle}</h1>
        <p className={ui.lede}>{COPY.nameLede}</p>

        <form className={styles.form}
              onSubmit={(e) => { e.preventDefault(); if (ready) keep(name); }}>
          <label className={styles.field}>
            <span className={styles.label}>{COPY.nameLabel}</span>
            <input className={styles.input} value={name} autoFocus
                   maxLength={40} placeholder={COPY.namePlaceholder}
                   onChange={(e) => setName(e.target.value)} />
          </label>

          {/* Held open whether or not there is a preview, so the button does not jump as
              soon as somebody types their first letter. */}
          <div className={styles.preview}>
            {preview ? (
              <>
                <p className={styles.previewLine}>
                  {COPY.namePreview} <strong className={styles.handle}>@{preview}</strong>
                </p>
                <p className={styles.why}>{COPY.nameWhySuffix}</p>
              </>
            ) : null}
          </div>

          <button type="submit" className={ui.btn} disabled={!ready}>{COPY.nameGo}</button>
        </form>

        {/* A first-class answer, not a failure. Somebody who would rather not be named on a
            screen about who can see what is making a reasonable choice, and the product
            worked exactly this way until tonight. */}
        <button type="button" className={styles.skip} onClick={() => keep(null)}>
          {COPY.nameSkip}
        </button>
      </div>
    </div>
  );
}
