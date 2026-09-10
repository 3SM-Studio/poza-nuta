import type { ReactNode } from "react";

import { PublicSiteHeader } from "@/components/public/public-site-header";

type PublicLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function PublicLayout({ children }: PublicLayoutProps) {
  return (
    <>
      <PublicSiteHeader />
      {children}
    </>
  );
}
