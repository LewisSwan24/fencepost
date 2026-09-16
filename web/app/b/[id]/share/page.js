"use client";

// 12 · Share. A code carrying an access level, not a public link.
//
// The plaintext token comes back only at issue time and the database holds only a hash —
// so this page shows it on arrival, stores nothing, and loses it on refresh. If you need
// another, issue another.
//
// Only an owner can revoke (the server's revoke_grant answers not_the_owner), so where
// owner_id does not match, the button is not drawn rather than drawn and then refused.

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { grants, issueShareLink, revokeGrant, shareLinks, revokeShareLink, me }
  from "../../../../lib/api";
import { COPY, LEVELS, EXPIRY } from "../../../../lib/copy";
import { until } from "../../../../lib/format";
import { BackButton, ui } from "../../../../components/ui";
import QrPlaceholder from "../../../../components/QrPlaceholder";
import QrCode from "../../../../components/QrCode";
import { shareUrl } from "../../../../lib/qr";
import styles from "./share.module.css";

export default function Share({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const [level, setLevel] = useState("contribute");
  const [days, setDays] = useState(7);
  const [issued, setIssued] = useState(null);
  const [access, setAccess] = useState(null);
  const [links, setLinks] = useState(null);
  const [who, setWho] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // The address a scan lands on. Null until a code exists, which is also what keeps the
  // placeholder in place. window is read here rather than at module scope because this file
  // is prerendered on the server, where there is no origin — and because issued is null on
  // the first render, the branch that reads it cannot run before hydration.
  const live = issued && typeof window !== "undefined"
    ? shareUrl(window.location.origin, issued.token)
    : null;

  // The server answers cannot_share to anybody below reshare, so this whole screen should
  // not be offered to them. The Share button on the storyboard page is already gated on
  // reshare, but somebody typing the address needs stopping too — otherwise the "make a
  // code" button is drawn and is certain to be refused.
  function loadAccess() {
    grants(id).then(setAccess, (e) => {
      if (e.code === "cannot_share" || e.status === 403) {
        router.replace("/b/" + id);
        return;
      }
      setError(e.message);
    });
  }

  function loadLinks() {
    shareLinks(id).then((view) => setLinks(view.links), () => {});
  }

  useEffect(() => {
    loadAccess();
    loadLinks();
    me().then(setWho, () => {});
  }, [id]);

  const iAmOwner = who && access && who.user_id === access.owner_id;

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      setIssued(await issueShareLink({ storyboardId: id, level, expiresInDays: days }));
      loadLinks();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  // Turn a code off. The server gate is "you issued it, or you are the owner" — **not
  // reshare**. So somebody holding reshare sees every code but can turn off only their own.
  function canTurnOff(link) {
    return !!who && (link.created_by === who.user_id || iAmOwner);
  }

  // Whether a code still works. Three ways of not working, each said separately rather
  // than all collapsed into "invalid".
  function stateOf(link) {
    if (link.revoked_at) return COPY.codeState.revoked;
    if (link.expires_at && new Date(link.expires_at) <= new Date()) return COPY.codeState.expired;
    if (link.max_uses !== null && link.used_count >= link.max_uses) return COPY.codeState.used_up;
    return null;
  }

  async function turnOff(linkId) {
    try {
      await revokeShareLink(linkId);
      loadLinks();
    } catch (e) {
      setError(e.message);
    }
  }

  async function revoke(userId) {
    try {
      await revokeGrant({ storyboardId: id, userId });
      loadAccess();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className={ui.screen}>
      <div className={ui.bar}>
        <BackButton onClick={() => router.push("/b/" + id)} />
      </div>

      <div className={ui.body}>
        <h1 className={styles.title}>{COPY.shareTitle}</h1>
        <p className={styles.lede}>{COPY.shareLede}</p>

        {/* The placeholder holds this spot until there is something to encode, and the real
            code takes over the moment there is. Drawing a scannable square before then would
            put one on screen pointing either somewhere invented or somewhere real, and the
            reason a placeholder was chosen in the first place is that both are wrong.
            QrCode returns null when it cannot encode a value, so the same fallback covers a
            token the library refuses. */}
        <div className={styles.qrWrap}>
          {live ? <QrCode value={live} /> : <QrPlaceholder />}
          <p className={styles.qrNote}>{live ? COPY.qrLive : COPY.qrNote}</p>
          {live ? <div className={styles.link}>{live}</div> : null}
        </div>

        <div className={ui.kicker}>{COPY.whatTheyCanDo}</div>
        {LEVELS.map((option) => {
          const on = level === option.id;
          return (
            <button key={option.id} type="button" aria-pressed={on}
                    className={[styles.option, on ? styles.optionOn : ""].join(" ")}
                    onClick={() => { setLevel(option.id); setIssued(null); }}>
              <span className={[styles.pip, on ? styles.pipOn : ""].join(" ")} />
              <span className={styles.optionText}>
                <span className={styles.optionLabel}>{option.label}</span>
                <span className={styles.optionSub}>{option.sub}</span>
              </span>
            </button>
          );
        })}

        <div className={ui.kicker}>{COPY.linkExpires}</div>
        <div className={styles.chips}>
          {EXPIRY.map((option) => (
            <button key={option.id} type="button"
                    className={[styles.chip, days === option.id ? styles.chipOn : ""].join(" ")}
                    onClick={() => { setDays(option.id); setIssued(null); }}>
              {option.label}
            </button>
          ))}
        </div>

        {/* Codes already issued. This block and "who has access" below are **two different
            things**, which is why they are two blocks: turning a code off stops the people
            who have not used it, while anybody who already redeemed it is unaffected and
            has to be revoked below. The reverse holds too — revoking somebody does not
            turn off a code they issued. Running the two together is a trap, and the copy
            says so. */}
        <div className={ui.kicker}>{COPY.codesForThisBoard}</div>
        <p className={styles.quiet}>{COPY.codesNote}</p>
        {links?.length === 0 ? <p className={styles.quiet}>{COPY.noCodesYet}</p> : null}
        {links?.map((link) => {
          const state = stateOf(link);
          return (
            <div key={link.id} className={[styles.code, state ? styles.codeOff : ""].join(" ")}>
              <span className={styles.codeText}>
                <span className={styles.codeLevel}>
                  {COPY.levelLabel[link.level]}
                  {state ? <span className={styles.codeState}>{state}</span> : null}
                </span>
                <span className={styles.codeMeta}>
                  {link.created_by === who?.user_id
                    ? COPY.codeMadeByYou
                    : COPY.codeMadeBy + " @" + link.created_by_handle}
                  {" · "}
                  {/* share_links has no created_at column, so it cannot say "issued three
                      days ago". All it can say is the expiry and the number of uses. */}
                  {link.expires_at
                    ? COPY.codeExpires + " " + until(link.expires_at)
                    : COPY.codeNoExpiry}
                  {link.used_count
                    ? " · " + COPY.codeUses + " " + link.used_count
                      + (link.max_uses ? "/" + link.max_uses : "")
                    : ""}
                </span>
              </span>
              {!state && canTurnOff(link) ? (
                <button type="button" className={styles.revoke} onClick={() => turnOff(link.id)}>
                  {COPY.turnOff}
                </button>
              ) : null}
            </div>
          );
        })}

        <div className={ui.kicker}>{COPY.whoHasAccess}</div>
        {error ? <p className={styles.error}>{error}</p> : null}
        {!access && !error ? <p className={styles.quiet}>Loading…</p> : null}
        {access?.grants.map((person) => (
          <div key={person.user_id} className={styles.person}>
            <span className={styles.avatar} aria-hidden="true">
              {person.handle.slice(0, 2)}
            </span>
            <span className={styles.personText}>
              <span className={styles.personName}>@{person.handle}</span>
              <span className={styles.personLevel}>{COPY.levelLabel[person.level]}</span>
            </span>
            {iAmOwner && person.user_id !== who.user_id ? (
              <button type="button" className={styles.revoke}
                      onClick={() => revoke(person.user_id)}>
                {COPY.revoke}
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <div className={ui.footer}>
        <button type="button" className={ui.btn} disabled={busy || !access} onClick={issue}>
          {busy ? "Making a code…" : issued ? "Make another code" : "Make a code"}
        </button>
      </div>
    </div>
  );
}
