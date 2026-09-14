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
import { grants, issueShareLink, revokeGrant, shareLinks, revokeShareLink, me }
  from "../../../../lib/api";
import { COPY, LEVELS, EXPIRY } from "../../../../lib/copy";
import { until } from "../../../../lib/format";
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
  const [links, setLinks] = useState(null);
  const [who, setWho] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // 服务端对非 reshare 回 cannot_share，所以这一屏整个就不该给他们。
  // 故事版页上的 Share 按钮已经按 reshare 收过了，但直接敲地址进来的还得挡一道——
  // 否则「发一张码」这个按钮会画出来，按下去必然被拒。
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

  // 关掉一张码。服务端的门是「你发的，或者你是 owner」——**不是 reshare**。
  // 所以一个 reshare 档的人看得到所有码，却只关得掉自己发的那些。
  function canTurnOff(link) {
    return !!who && (link.created_by === who.user_id || iAmOwner);
  }

  // 码现在还灵不灵。三种不灵法，各说各的，别都写成「无效」。
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

        {/* 发出去过的码。这一段和下面的「谁有权限」是**两件事**，所以分开两块：
            关掉一张码，挡的是还没用它的人；已经用它换到权限的人不受影响，
            那要去下面撤销。反过来也一样——撤销一个人的权限，不会关掉他发出去的码。
            两件事混在一屏里是个陷阱，文案里说清楚了。 */}
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
                  {/* share_links 没有 created_at 这一列，所以说不出「三天前发的」。
                      能说的只有到期和用了几次。 */}
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
