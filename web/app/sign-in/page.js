"use client";

// Signing in, and making an account. One screen with two modes rather than two routes:
// the fields are the same, the difference is one line of copy and which endpoint it calls,
// and somebody who came to the wrong one should not have to navigate to fix that.
//
// Two things this screen has to be honest about, both of them easier to leave out:
//
//   there is no password reset, because there is no email service behind this prototype;
//   an account is a *separate identity* from the guest this browser already made, so
//   entries written as a guest do not come across. They are not lost either — signing out
//   returns you to the same guest — and which of those it is matters enough to say.
//
// Failures are shown as the server worded them. The proxy answers with fixed copy, and for
// sign-in that copy is deliberately the same sentence whether the name is unknown or the
// password is wrong: saying which half failed tells somebody whether that name exists.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { registerAccount, signIn } from "../../lib/api";
import { COPY } from "../../lib/copy";
import { BackButton, Spinner, ui } from "../../components/ui";
import styles from "./sign-in.module.css";

export default function SignInScreen() {
  const router = useRouter();
  const [making, setMaking] = useState(false);
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const ready = handle.trim().length >= 3 && password.length >= 8;

  async function submit(event) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await (making ? registerAccount : signIn)(handle.trim(), password);
      router.replace("/you");
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className={ui.screen}>
      <div className={ui.bar}>
        <BackButton onClick={() => router.push("/you")} />
      </div>

      <div className={ui.body}>
        <h1 className={ui.h1}>{making ? COPY.registerTitle : COPY.signInTitle}</h1>
        <p className={styles.lede}>{making ? COPY.registerLede : COPY.signInLede}</p>

        <form className={styles.form} onSubmit={submit}>
          <label className={styles.field}>
            <span className={styles.label}>{COPY.handleLabel}</span>
            <input className={styles.input} value={handle} autoComplete="username"
                   autoCapitalize="none" autoCorrect="off" spellCheck="false"
                   onChange={(e) => setHandle(e.target.value)} />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>{COPY.passwordLabel}</span>
            {/* current-password and new-password are different hints to a password manager:
                one offers what is stored, the other offers to generate and save. */}
            <input className={styles.input} value={password} type="password"
                   autoComplete={making ? "new-password" : "current-password"}
                   onChange={(e) => setPassword(e.target.value)} />
          </label>

          {making ? <p className={styles.warn}>{COPY.noReset}</p> : null}
          {error ? <p className={styles.error}>{error}</p> : null}

          {busy ? (
            <Spinner label={making ? "Making your account" : "Signing in"} />
          ) : (
            <button type="submit" className={ui.btn} disabled={!ready}>
              {making ? COPY.registerTitle : COPY.signInTitle}
            </button>
          )}
        </form>

        <button type="button" className={styles.swap}
                onClick={() => { setMaking(!making); setError(null); }}>
          {making ? COPY.toSignIn : COPY.toRegister}
        </button>
      </div>
    </div>
  );
}
