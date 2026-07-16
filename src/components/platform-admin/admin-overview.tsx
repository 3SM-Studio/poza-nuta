import {
  Building2Icon,
  CalendarCheckIcon,
  CrownIcon,
  Music2Icon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PlatformAdminOverviewMetrics } from "@/server/platform-admin/overview-core";

export function AdminOverview({
  metrics,
}: {
  metrics: PlatformAdminOverviewMetrics;
}) {
  const cards = [
    {
      label: "Aktywni użytkownicy",
      value: metrics.activeOperators,
      description: "Aktywni i niezawieszeni operatorzy",
      icon: UsersIcon,
    },
    {
      label: "Eligible owners",
      value: metrics.eligibleOwners,
      description: "Właściciele spełniający warunki bezpieczeństwa",
      icon: CrownIcon,
    },
    {
      label: "Aktywne organizacje",
      value: metrics.activeWorkspaces,
      description: "Aktywne workspace w obecnym modelu",
      icon: Building2Icon,
    },
    {
      label: "Katalog piosenek",
      value: metrics.catalogSongs,
      description: "Piosenki dostępne w katalogu",
      icon: Music2Icon,
    },
    {
      label: "Aktywne wydarzenia publiczne",
      value: metrics.activePublicEvents,
      description: "Wydarzenia oznaczone jako aktywne publicznie",
      icon: CalendarCheckIcon,
    },
  ];

  return (
    <div className="grid gap-7">
      <header className="grid gap-1">
        <p className="m-0 text-sm font-medium text-primary">Platforma</p>
        <h1 className="m-0 text-2xl font-semibold tracking-normal sm:text-3xl">
          Overview
        </h1>
        <p className="m-0 max-w-2xl text-sm text-muted-foreground sm:text-base">
          Bezpieczny, tylko do odczytu obraz bieżącego stanu platformy.
        </p>
      </header>

      <section aria-label="Metryki platformy" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(({ label, value, description, icon: Icon }) => (
          <Card key={label} className="min-h-40">
            <CardHeader>
              <CardDescription className="flex items-center gap-2">
                <Icon aria-hidden="true" />
                {label}
              </CardDescription>
              <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {description}
            </CardContent>
          </Card>
        ))}
      </section>

      <section aria-labelledby="platform-role-breakdown" className="grid gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheckIcon className="text-primary" aria-hidden="true" />
          <h2 id="platform-role-breakdown" className="m-0 text-lg font-semibold">
            Aktywne role platformowe
          </h2>
        </div>
        <dl className="grid gap-2 sm:grid-cols-3">
          <RoleCount label="Właściciele" value={metrics.activePlatformMemberships.platform_owner} />
          <RoleCount label="Administratorzy" value={metrics.activePlatformMemberships.platform_admin} />
          <RoleCount label="Wsparcie" value={metrics.activePlatformMemberships.support} />
        </dl>
      </section>
    </div>
  );
}

function RoleCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 border-b border-border py-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="m-0 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
