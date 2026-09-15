// Image credits. CC BY-SA 4.0 requires attribution and requires saying whether anything
// was changed — a licence condition rather than a courtesy, which is why this is in the
// app and not only in the README.
//
// The first paragraph is the important part of this page: it says these photographs are
// not the users'. In the interface they sit next to other people's stories, and not
// saying so implies "this is the one they filmed".

import { FRAMES } from "../../lib/frames";
import styles from "./credits.module.css";

export const metadata = { title: "Fencepost — image credits" };

export default function Credits() {
  return (
    <div className={styles.page}>
      <a className={styles.back} href="/">← Fencepost</a>
      <h1 className={styles.title}>Image credits</h1>

      <p className={styles.lede}>
        The photographs in this prototype are <strong>not</strong> the sightings they sit
        beside. In Fencepost, that space holds a still from the video the person filmed
        themselves. These are stand-ins, borrowed so the screens are not empty rectangles,
        and matched to the species the entry names — nothing more.
      </p>

      <p className={styles.lede}>
        All ten are from Wikimedia Commons under{" "}
        <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="license noreferrer"
           target="_blank">CC BY-SA 4.0</a>, which asks for attribution and for changes to be
        noted. Nine were taken in daylight and are darkened and desaturated here, because
        Fencepost happens between dusk and late night. That darkening makes them modified
        works, and it is listed against each one below. Every file was resized and had its
        camera metadata and location removed before use, and one was cropped to fit a
        landscape slot.
      </p>

      <ul className={styles.list}>
        {FRAMES.map((frame) => (
          <li key={frame.slug} className={styles.item}>
            <img className={styles.thumb} src={frame.file} alt="" />
            <div className={styles.detail}>
              <div className={styles.who}>{frame.author}</div>
              <div className={styles.where}>{frame.where}</div>
              <div className={styles.meta}>
                <a href={frame.source} rel="noreferrer" target="_blank">Wikimedia Commons</a>
                {" · "}
                <a href={frame.licenceUrl} rel="license noreferrer" target="_blank">
                  {frame.licence}
                </a>
                {" · "}
                {/* Built from the data rather than written out, because this is the part
                    the licence actually asks for. It used to read "used as taken" for the
                    night shot, which was never true — that one was resized and stripped
                    like the rest, it just was not darkened. */}
                {["resized", "metadata removed",
                  frame.cropped ? "cropped" : null,
                  frame.night ? null : "darkened"].filter(Boolean).join(", ")}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <p className={styles.foot}>
        Fencepost is a student project for DECO7285 and is not affiliated with any of the
        photographers above.
      </p>
    </div>
  );
}
