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

export function Sheet({ onClose, children, labelledBy }) {
  return (
    <div className={styles.sheetScrim} onClick={onClose} role="presentation">
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby={labelledBy}
           onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
