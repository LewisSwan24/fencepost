"use client";

// 12 · Share。带权限的码，不是公开链接。
//
// 明文 token 只在签发那一次回来，库里只有哈希——所以这一页拿到就显示，不存，
// 刷新就没了。要新的就再签一张。
//
// 撤销只有 owner 能做（服务端 revoke_grant 回 not_the_owner），所以 owner_id
// 对不上就不显示那个按钮，而不是让人点了才发现不行。

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { grants, issueShareLink, revokeGrant, me } from "../../../../lib/api";
import { COPY, LEVELS, EXPIRY } from "../../../../lib/copy";
import { BackButton, ui } from "../../../../components/ui";
import QrPlaceholder from "../../../../components/QrPlaceholder";
import styles from "./share.module.css";

export default function Share({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const [level, setLevel] = useState("contribute");
  const [days, setDays] = useState(7);
  const [issued, setIssued] = useState(null);
  const [access, setAccess] = useState(null);
  const [who, setWho] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function loadAccess() {
    grants(id).then(setAccess, (e) => setError(e.message));
  }

  useEffect(() => {
    loadAccess();
    me().then(setWho, () => {});
  }, [id]);

  const iAmOwner = who && access && who.user_id === access.owner_id;

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      setIssued(await issueShareLink({ storyboardId: id, level, expiresInDays: days }));
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
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

        <div className={styles.qrWrap}>
          <QrPlaceholder />
          <p className={styles.qrNote}>{COPY.qrNote}</p>
          {issued ? (
            <div className={styles.link}>
              {typeof window === "undefined" ? "" : window.location.origin}/s/{issued.token}
            </div>
          ) : null}
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
        <button type="button" className={ui.btn} disabled={busy} onClick={issue}>
          {busy ? "Making a code…" : issued ? "Make another code" : "Make a code"}
        </button>
      </div>
    </div>
  );
}
