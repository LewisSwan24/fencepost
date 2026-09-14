// 占位图形，不是真的 QR。设计提示词里就写着「画个占位图形即可，不要真生成」——
// 真生成要引依赖，而且一个能扫的码在原型里反而危险：扫出来的链接是活的。
// 图案用固定种子，每次渲染一模一样，截图也稳定。
const SIZE = 17;

function pattern() {
  let seed = 20260913;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const rows = [];
  for (let y = 0; y < SIZE; y++) {
    const row = [];
    for (let x = 0; x < SIZE; x++) {
      const corner =
        (x < 5 && y < 5) || (x >= SIZE - 5 && y < 5) || (x < 5 && y >= SIZE - 5);
      if (corner) {
        const lx = x < 5 ? x : SIZE - 1 - x;
        const ly = y < 5 ? y : SIZE - 1 - y;
        row.push(Math.max(Math.abs(lx - 2), Math.abs(ly - 2)) !== 1);
      } else {
        row.push(rnd() > 0.52);
      }
    }
    rows.push(row);
  }
  return rows;
}

const ROWS = pattern();

export default function QrPlaceholder({ cell = 9 }) {
  return (
    <div aria-hidden="true"
         style={{ padding: 14, borderRadius: "var(--radius-md)", background: "var(--text)" }}>
      {ROWS.map((row, y) => (
        <div key={y} style={{ display: "flex" }}>
          {row.map((on, x) => (
            <span key={x} style={{ width: cell, height: cell,
                                   background: on ? "var(--on-accent)" : "transparent" }} />
          ))}
        </div>
      ))}
    </div>
  );
}
