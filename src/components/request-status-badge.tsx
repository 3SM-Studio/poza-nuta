import {
  BanIcon,
  CheckIcon,
  CircleCheckIcon,
  Clock3Icon,
  Mic2Icon,
  XIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { DashboardEventQueueRequestStatus } from "@/lib/dashboard-event-queue";
import { cn } from "@/lib/utils";

const presentations = {
  pending: {
    label: "Oczekujące",
    icon: Clock3Icon,
    className:
      "border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-200",
  },
  approved: {
    label: "Zaakceptowane",
    icon: CheckIcon,
    className:
      "border-blue-500/40 bg-blue-500/15 text-blue-800 dark:text-blue-200",
  },
  now: {
    label: "W trakcie",
    icon: Mic2Icon,
    className:
      "border-cyan-500/40 bg-cyan-500/15 text-cyan-800 dark:text-cyan-200",
  },
  done: {
    label: "Zagrane",
    icon: CircleCheckIcon,
    className:
      "border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
  },
  skipped: {
    label: "Pominięte",
    icon: BanIcon,
    className:
      "border-gray-500/40 bg-gray-500/15 text-gray-700 dark:text-gray-200",
  },
  rejected: {
    label: "Odrzucone",
    icon: XIcon,
    className:
      "border-red-500/40 bg-red-500/15 text-red-800 dark:text-red-200",
  },
} satisfies Record<
  DashboardEventQueueRequestStatus,
  { label: string; icon: typeof Clock3Icon; className: string }
>;

export function RequestStatusBadge({
  status,
  className,
}: {
  status: DashboardEventQueueRequestStatus;
  className?: string;
}) {
  const presentation = presentations[status];
  const Icon = presentation.icon;

  return (
    <Badge
      variant="outline"
      className={cn(presentation.className, className)}
      data-request-status={status}
    >
      <Icon aria-hidden="true" data-icon="inline-start" />
      {presentation.label}
    </Badge>
  );
}
