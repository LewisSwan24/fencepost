// 14 · 链接不管用。
//
// 这一屏什么都不能泄漏：不显示标题、不显示参与者、不说里面有什么，
// 也不说是过期了还是被撤销了——两种情况看起来必须一模一样，否则一条死链就成了
// 探测工具：换个 token 试，从措辞的差别里就能读出「这个故事版存在」。
//
// 它不取任何数据，所以是个静态页，连 "use client" 都不需要。

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
