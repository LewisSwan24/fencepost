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

// 五步进度条。写 entry 是第五步。
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

// 帧位。原型里是可拖图的占位组件；这里不接真素材，画一块夜色就够了，
// 说明写在上面——不要放真实照片，也不要放卡通负鼠。
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

// 能接焦点的东西，用来把 Tab 关在对话框里。
const FOCUSABLE = 'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])';

export function Sheet({ onClose, children, labelledBy }) {
  const box = useRef(null);
  const opener = useRef(null);

  useEffect(() => {
    opener.current = document.activeElement;
    // 焦点移到面板本身，而不是里面第一个输入框：这是个手机形状的界面，自动聚焦
    // 文本框会把软键盘顶起来盖掉半屏。APG 明确允许聚焦对话框容器。
    box.current?.focus();
    return () => {
      // 关掉之后回到刚才按下的那个按钮，而不是丢回 <body> 让人从页首重新 Tab 一遍。
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
    // aria-modal="true" 是在跟读屏软件说「外面那一切都不存在」。不把 Tab 关住，
    // 这句话就是假的 —— 人会一路 Tab 到刚被声明为不存在的那半个页面上去。
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
