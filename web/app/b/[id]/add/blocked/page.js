"use client";

// 8b · 投稿被拦下。
//
// 作者看到的只有 reason_codes 翻出来的那句话。没有 verdict，没有 note，
// 没有任何能被读成「系统对你下了判断」的东西。输入的内容原样留着——
// 草稿活在 add 那层 layout 的 context 里，退回去还在。

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
