import type { LucideIcon } from "lucide-react";
import {
  BanIcon,
  CheckCircle2Icon,
  CircleXIcon,
  Clock3Icon,
  LoaderCircleIcon,
} from "lucide-react";

import type { ImportJobViewModel } from "@/server/platform-admin/import-admin-core";

export type ImportJobStatusTone =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "cancelling";

export type ImportJobStatusPresentation = {
  label: string;
  icon: LucideIcon;
  className: string;
  tone: ImportJobStatusTone;
};

export const importJobStatusPresentation = {
  queued: {
    label: "W kolejce",
    icon: Clock3Icon,
    className:
      "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100",
    tone: "queued",
  },
  running: {
    label: "W trakcie",
    icon: LoaderCircleIcon,
    className:
      "border-blue-300 bg-blue-50 text-blue-950 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-100",
    tone: "running",
  },
  succeeded: {
    label: "Zakończony",
    icon: CheckCircle2Icon,
    className:
      "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100",
    tone: "succeeded",
  },
  failed: {
    label: "Nieudany",
    icon: CircleXIcon,
    className:
      "border-red-300 bg-red-50 text-red-950 dark:border-red-700 dark:bg-red-950 dark:text-red-100",
    tone: "failed",
  },
  cancelled: {
    label: "Anulowany",
    icon: BanIcon,
    className:
      "border-zinc-300 bg-zinc-100 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100",
    tone: "cancelled",
  },
} as const satisfies Record<
  ImportJobViewModel["status"],
  ImportJobStatusPresentation
>;

const cancellingPresentation = {
  label: "Anulowanie…",
  icon: LoaderCircleIcon,
  className:
    "border-orange-300 bg-orange-50 text-orange-950 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-100",
  tone: "cancelling",
} as const satisfies ImportJobStatusPresentation;

export function getImportJobStatusPresentation(
  status: ImportJobViewModel["status"],
  cancellationRequestedAt: string | null,
): ImportJobStatusPresentation {
  if (status === "running" && cancellationRequestedAt !== null) {
    return cancellingPresentation;
  }

  return importJobStatusPresentation[status];
}
