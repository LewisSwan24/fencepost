export const metadata = {
  title: "Fencepost harness",
  description: "Thin client that exercises the Fencepost API end to end.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: "24px",
          fontFamily: "system-ui, sans-serif",
          lineHeight: 1.5,
          maxWidth: 820,
        }}
      >
        {children}
      </body>
    </html>
  );
}
