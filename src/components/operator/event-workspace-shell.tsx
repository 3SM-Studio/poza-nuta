import type { ReactNode } from "react";

import type { DashboardEventLifecycleStatus } from "@/lib/dashboard-event-lifecycle";

import { EventWorkspaceHeader } from "./event-workspace-header";

export type EventWorkspaceModel = {
  event: {
    publicId: string;
    name: string;
    venue: string | null;
    city: string | null;
    startsAt: Date;
    closesAt: Date;
    lifecycle: DashboardEventLifecycleStatus;
    visibility: "private" | "public";
    slug: string | null;
  };
};

export function EventWorkspaceShell({
  workspace,
  children,
}: {
  workspace: EventWorkspaceModel;
  children: ReactNode;
}) {
  return (
    <section
      className="mx-auto w-full min-w-0 max-w-[72rem] space-y-5"
      data-event-workspace="true"
    >
      <EventWorkspaceHeader event={workspace.event} />
      <div className="min-w-0">{children}</div>
    </section>
  );
}
