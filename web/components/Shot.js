import styles from "./Shot.module.css";

// A single night frame. With a picture it shows the picture, without one it shows the dark
// — the height and the corner radius are the same either way, so the layout does not jump
// before and after an image arrives.
//
// When something sits on top of the frame (children), a bottom-up dark wash goes
// underneath: without it, sooner or later a picture is bright exactly there and the text
// becomes unreadable. So it follows children rather than always being present — laying it
// down over nothing only darkens every photograph for no reason.
//
// Material lives in web/public/frames/. Two hard requirements from the CLAUDE.md safety
// lines:
//   strip EXIF and GPS before adding anything — a photograph carries where it was taken,
//   and this product is about not giving away where you live;
//   faces and number plates have to be covered.
// Stripping EXIF has to happen before the file gets here; a browser will not do it for you.
// radius takes md | lg | none. "none" is for the list card: the card is already rounded
// with overflow:hidden, and rounding the image again nests a second curve inside the card.
// `aspect` (width / height) replaces the fixed height with the picture's own shape. Without
// it a portrait frame is cropped to whatever height was asked for: measured on 2026-09-16, a
// 360x640 still in the 206px-tall frame picker showed 35% of itself, and the missing 65%
// included the top of the frame — so somebody chose a still without seeing the part most
// likely to need masking, and the very next screen then showed them the whole thing.
//
// The *width* is what gets bounded, not the height. Bounding the height would leave the
// element full width and silently distort the picture, which is the same mistake wearing a
// different hat.
export default function Shot({ src, alt, height = 170, radius = "md", graded = false,
                              aspect = null, maxHeight = "42vh", children }) {
  const shape = aspect
    ? { aspectRatio: String(aspect), height: "auto", width: "100%",
        maxWidth: `calc(${maxHeight} * ${aspect})`, margin: "0 auto" }
    : { height };
  return (
    <div
      className={[styles.shot, styles[radius] || styles.md].join(" ")}
      style={shape}
    >
      {src ? (
        // With no alt it counts as decorative and a screen reader skips it, which beats
        // reading out a filename.
        <img className={[styles.img, graded ? styles.graded : ""].join(" ")}
             src={src} alt={alt || ""} loading="lazy" />
      ) : null}
      {/* The wash appears only when something really sits on the frame. It is there to
          keep that text readable rather than as decoration; laying it down with no
          children only darkens every photograph for nothing. */}
      {children ? <span className={styles.scrim} aria-hidden="true" /> : null}
      {children}
    </div>
  );
}
