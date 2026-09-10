import type { ReactNode } from "react";

import { OperatorAppLayout } from "@/components/operator/operator-app-layout";

export const dynamic = "force-dynamic";

export default function DashboardLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return <OperatorAppLayout>{children}</OperatorAppLayout>;
}
