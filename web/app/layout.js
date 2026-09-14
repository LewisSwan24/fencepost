import { Caprasimo, Figtree } from "next/font/google";
import "./globals.css";
import styles from "./layout.module.css";

// The two faces the design system specifies. Caprasimo is for the wordmark only — the
// reason is in the comment in globals.css.
const body = Figtree({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--font-body" });
const display = Caprasimo({ subsets: ["latin"], weight: "400", variable: "--font-display" });

export const metadata = {
  title: "Fencepost",
  description: "Possum sightings, kept by the street that filmed them.",
};

export const viewport = {
  themeColor: "#100e0c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable}`}>
      <body>
        {/* Mobile first. No fake phone frame on the desktop — something really deployed
            pretending to be a phone is awkward; a maximum width that holds it in on a
            large screen is enough. */}
        <div className={styles.shell}>{children}</div>
      </body>
    </html>
  );
}
