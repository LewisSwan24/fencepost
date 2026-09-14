// A placeholder graphic, not a real QR code. The design prompt said to draw a placeholder
// and not to generate one for real — generating needs a dependency, and a scannable code
// is actually dangerous in a prototype, because the link it resolves to is live.
// The pattern uses a fixed seed, so every render is identical and screenshots are stable.
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
