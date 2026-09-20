// next/font/google, used once, in layout.js, for Caprasimo and Figtree.
//
// The real thing downloads the font at build time and hands back a generated class name. A
// test has nothing to say about either, so the stub returns the shape the layout destructures
// and a class name that says where it came from.

function font({ variable } = {}) {
  return {
    className: "font",
    variable: variable ?? "--font",
    style: { fontFamily: "font" },
  };
}

export const Caprasimo = font;
export const Figtree = font;

// Any other family the layout grows into resolves the same way rather than crashing on an
// undefined import.
export default font;
