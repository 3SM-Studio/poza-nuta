"use client";

import { AdminErrorState } from "@/components/platform-admin/admin-error-state";

export default function PlatformAdminError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <AdminErrorState reset={reset} />;
}
