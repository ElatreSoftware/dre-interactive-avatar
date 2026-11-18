import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dr.E Interactive Avatar",
  description: "Elatre's custom interactive avatar widget",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
