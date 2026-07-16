import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Poza Nutą",
  description: "Nowa aplikacja Poza Nutą",
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="pl" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
