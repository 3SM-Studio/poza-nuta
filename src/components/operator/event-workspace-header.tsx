import {
  CalendarClockIcon,
  CheckCircle2Icon,
  CircleXIcon,
  Clock3Icon,
  MapPinIcon,
  RadioIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { DashboardEventLifecycleStatus } from "@/lib/dashboard-event-lifecycle";
import { formatWarsawDateTime } from "@/lib/warsaw-time";

export function EventWorkspaceHeader({
  event,
}: {
  event: {
    name: string;
    venue: string | null;
    city: string | null;
    startsAt: Date;
    closesAt: Date;
    lifecycle: DashboardEventLifecycleStatus;
  };
}) {
  const status = getLifecyclePresentation(event.lifecycle);
  const StatusIcon = status.icon;
  const location = [event.venue, event.city].filter(Boolean).join(", ");

  return (
    <header className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">
            Wydarzenie
          </p>
          <h1 className="mt-1 break-words text-2xl font-semibold leading-tight tracking-tight [overflow-wrap:anywhere] lg:text-3xl">
            {event.name}
          </h1>
        </div>
        <Badge className="w-fit shrink-0 gap-1.5" variant={status.variant}>
          <StatusIcon aria-hidden="true" className="size-3.5" />
          {status.label}
        </Badge>
      </div>

      <div className="flex min-w-0 flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
        <span className="flex min-w-0 items-start gap-2">
          <Clock3Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="break-words [overflow-wrap:anywhere]">
            {formatWarsawDateTime(event.startsAt)} –{" "}
            {formatWarsawDateTime(event.closesAt)}
          </span>
        </span>
        {location ? (
          <span className="flex min-w-0 items-start gap-2">
            <MapPinIcon
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />
            <span className="break-words [overflow-wrap:anywhere]">
              {location}
            </span>
          </span>
        ) : null}
      </div>
    </header>
  );
}

function getLifecyclePresentation(status: DashboardEventLifecycleStatus) {
  switch (status) {
    case "active":
      return { label: "Aktywne", icon: RadioIcon, variant: "default" as const };
    case "scheduled":
      return {
        label: "Zaplanowane",
        icon: CalendarClockIcon,
        variant: "outline" as const,
      };
    case "closed":
      return {
        label: "Zamknięte",
        icon: CheckCircle2Icon,
        variant: "secondary" as const,
      };
    case "cancelled":
      return {
        label: "Anulowane",
        icon: CircleXIcon,
        variant: "secondary" as const,
      };
  }
}
