"use client";

// 6 · Which one is it?
//
// 建议永不预选。它只是一句话加一个按钮，Next 一直禁用到用户自己点了某一档。
// 而且那句话是模型回的散文，物种是这边从句子里认出来的——认不出（同时提到两种，
// 或者一种都没提）就只显示句子，不给「Use this」。宁可不给，也不替用户选。

import { use } from "react";
import { useRouter } from "next/navigation";
import { SPECIES, suggestedSpecies } from "../../../../../lib/fixtures";
import { BackButton, Steps, ui } from "../../../../../components/ui";
import { useDraft } from "../DraftContext";
import styles from "./species.module.css";

export default function WhichOne({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const draft = useDraft();

  const suggested = draft.suggestion ? suggestedSpecies(draft.suggestion) : null;
  const label = suggested ? SPECIES.find((s) => s.id === suggested)?.label : null;

  return (
    <div className={ui.screen}>
      <div className={ui.bar}>
        <BackButton onClick={() => router.push(`/b/${id}/add/mask`)} />
      </div>
      <Steps at={3} />

      <div className={ui.body}>
        <h1 className={ui.h1} style={{ marginBottom: 18 }}>Which one is it?</h1>

        {draft.suggestion ? (
          <div className={styles.suggestion}>
            <div className={styles.kicker}>From the frame you sent</div>
            <p className={styles.sentence}>{draft.suggestion}</p>
            {suggested ? (
              <div className={styles.suggestionActions}>
                <button type="button" className={styles.use}
                        onClick={() => draft.setSpecies(suggested)}>
                  Use {label}
                </button>
                <button type="button" className={styles.dismiss}
                        onClick={() => draft.setSuggestion(null)}>
                  Pick a different one
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className={styles.options}>
          {SPECIES.map((option) => {
            const picked = draft.species === option.id;
            return (
              <button key={option.id} type="button"
                      className={[styles.option, picked ? styles.optionOn : ""].join(" ")}
                      aria-pressed={picked}
                      onClick={() => draft.setSpecies(option.id)}>
                <span className={[styles.pip, picked ? styles.pipOn : ""].join(" ")} />
                <span className={styles.optionText}>
                  <span className={styles.optionLabel}>{option.label}</span>
                  <span className={styles.optionSub}>{option.sub}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className={ui.footer}>
        <button type="button" className={ui.btn} disabled={!draft.species}
                onClick={() => router.push(`/b/${id}/add/write`)}>Next</button>
      </div>
    </div>
  );
}
