import { Caprasimo, Figtree } from "next/font/google";
import "./globals.css";
import styles from "./layout.module.css";

// 设计系统指定的两款。Caprasimo 只给字标用，理由见 globals.css 里那段注释。
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
        {/* 移动优先。桌面上不画假手机框——真部署的东西假装成手机很别扭；
            给一个最大宽度让它在大屏上收住就够了。 */}
        <div className={styles.shell}>{children}</div>
      </body>
    </html>
  );
}
