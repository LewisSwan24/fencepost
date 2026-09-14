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
export default function Shot({ src, alt, height = 170, radius = "md", graded = false, children }) {
  return (
    <div
      className={[styles.shot, styles[radius] || styles.md].join(" ")}
      style={{ height }}
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
