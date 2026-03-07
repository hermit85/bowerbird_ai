import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "deplo.app Console",
  description: "Local control plane for deplo.app",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
