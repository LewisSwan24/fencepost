import { matrix } from "../lib/qr";

// A real, scannable code for one issued share link.
//
// Drawn as inline SVG rather than a grid of elements, because a code gets photographed off
// a screen at whatever angle two people happen to be standing at: vector modules stay square
// at any size, and a canvas would need a device-pixel-ratio dance to avoid the soft edges
// that cost a scan.
//
// The quiet zone is not decoration. The specification asks for four clear modules on every
// side, and without it a decoder often will not lock on at all. It is part of the viewBox so
// it scales with everything else.
const QUIET = 4;

export default function QrCode({ value, size = 188, label }) {
  const rows = matrix(value);
  // No code yet, or a value this library cannot encode. The caller decides what to show
  // instead; taking the share screen down over a picture would be the wrong trade.
  if (!rows) return null;

  const n = rows.length;
  const span = n + QUIET * 2;

  // One path for every dark module beats one <rect> each: a version 3 code is around 700
  // modules and about half of them are dark.
  let d = "";
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      if (rows[y][x]) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${span} ${span}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label || "QR code for this share link"}
      style={{ borderRadius: "var(--radius-md)", display: "block" }}
    >
      {/* Light ground under the modules, quiet zone included. Every screen around this one
          is dark, and a code inverted against its surroundings is a code most phones will
          not read. */}
      <rect width={span} height={span} fill="#f4ebdc" />
      <path d={d} fill="#0f0d0b" />
    </svg>
  );
}
