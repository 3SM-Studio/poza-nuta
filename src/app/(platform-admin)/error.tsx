"use client";

import { AdminErrorState } from "@/components/platform-admin/admin-error-state";

export default function PlatformAdminLayoutError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-4 text-foreground">
      <AdminErrorState reset={reset} />
    </main>
  );
}
