import localFont from "next/font/local";
import "./globals.css";
import RouteShell from "../components/RouteShell";
const body = localFont({src:[{path:"./fonts/figtree-latin-400-normal.woff2",weight:"400"},{path:"./fonts/figtree-latin-600-normal.woff2",weight:"600"},{path:"./fonts/figtree-latin-700-normal.woff2",weight:"700"}],variable:"--font-body",display:"swap"});
const display = localFont({src:"./fonts/caprasimo-latin-400-normal.woff2",variable:"--font-display",display:"swap"});

export const metadata = {
  title: "Fencepost — Wildlife Neighbours",
  description: "Moderated neighbourhood wildlife observations, practical guidance and optional habitat care.",
  icons: {icon:"/wildlife/assets/neutral-fallback.svg"},
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
        {/* NameGate sits above every route because the question it asks has to be settled
            before the first request goes out, and requests start from the pages' own
            effects. It renders children untouched for anybody this browser already has a
            name for, which is everybody after the first visit. */}
        <RouteShell>{children}</RouteShell>
      </body>
    </html>
  );
}
