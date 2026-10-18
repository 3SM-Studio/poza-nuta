"use client";

import { AdminErrorState } from "@/components/platform-admin/admin-error-state";

export default function PlatformAdminLayoutError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <AdminErrorState reset={retry} embedded={false} />;
}
