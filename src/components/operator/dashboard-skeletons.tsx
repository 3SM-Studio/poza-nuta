import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";


export function DashboardPageSkeleton() {
  return (
    <main className={"min-h-[calc(100vh-4.5rem)] min-w-0 bg-background text-foreground"}>
      <section
        className={"mx-auto w-full min-w-0 max-w-[72rem]"}
        role="status"
        aria-label="Ładowanie dashboardu"
      >
        <span className="sr-only">Ładowanie dashboardu</span>
        <PageHeaderSkeleton action />
        <div className={"grid min-w-0 gap-4"}>
          <WideCardSkeleton />
          <OrganizationsListSkeletonContent count={2} />
        </div>
      </section>
    </main>
  );
}

export function OrganizationsListSkeleton() {
  return (
    <main className={"min-h-[calc(100vh-4.5rem)] min-w-0 bg-background text-foreground"}>
      <section
        className={"mx-auto w-full min-w-0 max-w-[72rem]"}
        role="status"
        aria-label="Ładowanie listy organizacji"
      >
        <span className="sr-only">Ładowanie listy organizacji</span>
        <PageHeaderSkeleton action />
        <OrganizationsListSkeletonContent count={3} />
      </section>
    </main>
  );
}

export function OrganizationOverviewSkeleton() {
  return (
    <main className={"min-h-[calc(100vh-4.5rem)] min-w-0 bg-background text-foreground"}>
      <section
        className={"mx-auto w-full min-w-0 max-w-[72rem]"}
        role="status"
        aria-label="Ładowanie organizacji"
      >
        <span className="sr-only">Ładowanie organizacji</span>
        <PageHeaderSkeleton action />
        <OverviewMetricCardsSkeleton />
        <OverviewActivitySkeleton />
      </section>
    </main>
  );
}

export function OverviewMetricCardsSkeleton() {
  return (
    <section className={"mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3"} aria-label="Ładowanie statystyk">
      {Array.from({ length: 9 }, (_, index) => (
        <Card key={index} size="sm">
          <CardHeader>
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-4 w-24" />
          </CardHeader>
        </Card>
      ))}
    </section>
  );
}

export function OverviewActivitySkeleton() {
  return (
    <>
      <div className={"grid grid-cols-1 gap-4 lg:grid-cols-2"}>
        <Card className={"mb-4"}>
          <CardHeader>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-6 w-56 max-w-full" />
            </div>
            <CardAction>
              <Skeleton className="h-8 w-24" />
            </CardAction>
          </CardHeader>
          <CardContent>
            <DetailsGridSkeleton />
          </CardContent>
        </Card>

        <Card className={"mb-4"}>
          <CardHeader>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-6 w-40" />
            </div>
            <CardAction>
              <Skeleton className="h-8 w-28" />
            </CardAction>
          </CardHeader>
          <CardContent>
            <OverviewRowsSkeleton count={3} />
          </CardContent>
        </Card>
      </div>

      <Card className={"mb-4"}>
        <CardHeader>
          <CardDescription>
            <Skeleton className="h-4 w-52 max-w-full" />
          </CardDescription>
          <CardTitle>
            <Skeleton className="h-6 w-72 max-w-full" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <OverviewRowsSkeleton count={4} showMetric />
        </CardContent>
      </Card>
    </>
  );
}

export function AccountPageSkeleton() {
  return (
    <main className={"min-h-[calc(100vh-4.5rem)] min-w-0 bg-background text-foreground"}>
      <section
        className={"mx-auto w-full min-w-0 max-w-[72rem]"}
        role="status"
        aria-label="Ładowanie konta"
      >
        <span className="sr-only">Ładowanie konta</span>
        <PageHeaderSkeleton />
        <div className={"grid min-w-0 gap-4"}>
          <AccountCardSkeleton />
          <AccountCardSkeleton />
        </div>
      </section>
    </main>
  );
}

export function SettingsPageSkeleton() {
  return (
    <main className={"min-h-[calc(100vh-4.5rem)] min-w-0 bg-background text-foreground"}>
      <section
        className={"mx-auto w-full min-w-0 max-w-[58rem]"}
        role="status"
        aria-label="Ładowanie ustawień"
      >
        <span className="sr-only">Ładowanie ustawień</span>
        <PageHeaderSkeleton action />
        <div className={"grid min-w-0 gap-4"}>
          <WideCardSkeleton />
          <FormCardSkeleton />
        </div>
      </section>
    </main>
  );
}

export function PublicQueueSkeleton() {
  return (
    <section
      className="flex flex-col gap-3"
      role="status"
      aria-label="Ładowanie publicznej kolejki"
    >
      <span className="sr-only">Ładowanie publicznej kolejki</span>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-6 w-56 max-w-full" />
          </div>
        </CardHeader>
        <CardContent>
          <OverviewRowsSkeleton count={4} showMetric />
        </CardContent>
      </Card>
    </section>
  );
}

function PageHeaderSkeleton({ action = false }: { action?: boolean }) {
  return (
    <header className={"mb-4 flex min-w-0 flex-col gap-4 py-1 sm:flex-row sm:items-center sm:justify-between [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight lg:[&_h1]:text-3xl"}>
      <div className="flex min-w-0 flex-col gap-2">
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {action ? <Skeleton className="h-10 w-36" /> : null}
    </header>
  );
}

function OrganizationsListSkeletonContent({ count }: { count: number }) {
  return (
    <div className={"grid min-w-0 gap-4"}>
      {Array.from({ length: count }, (_, index) => (
        <Card key={index}>
          <CardHeader>
            <Skeleton className="h-6 w-52 max-w-full" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-7 w-28" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function WideCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-48 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </CardHeader>
      <CardContent>
        <DetailsGridSkeleton />
      </CardContent>
    </Card>
  );
}

function FormCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-44 max-w-full" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-11 w-full" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
      </CardContent>
    </Card>
  );
}

function AccountCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-48 max-w-full" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </CardHeader>
      <CardContent>
        <DetailsGridSkeleton />
      </CardContent>
    </Card>
  );
}

function DetailsGridSkeleton() {
  return (
    <div className={"grid grid-cols-1 gap-3 sm:grid-cols-2 [&_div]:rounded-md [&_div]:bg-muted/40 [&_div]:p-3 [&_dt]:text-xs [&_dt]:font-semibold [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:text-sm [&_dd]:font-semibold"}>
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index}>
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-5 w-32 max-w-full" />
        </div>
      ))}
    </div>
  );
}

function OverviewRowsSkeleton({
  count,
  showMetric = false,
}: {
  count: number;
  showMetric?: boolean;
}) {
  return (
    <div className={"grid gap-3"}>
      {Array.from({ length: count }, (_, index) => (
        <div className={showMetric ? "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md bg-muted/40 p-3 [&_strong]:block [&_strong]:text-sm [&_p]:mt-1 [&_p]:text-sm [&_p]:text-muted-foreground" : "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md bg-muted/40 p-3 [&_strong]:block [&_strong]:text-sm [&_p]:mt-1 [&_p]:text-sm [&_p]:text-muted-foreground"} key={index}>
          <div className="flex min-w-0 flex-col gap-2">
            <Skeleton className="h-5 w-48 max-w-full" />
            <Skeleton className="h-4 w-36 max-w-full" />
          </div>
          <div className="flex flex-col items-end gap-2">
            <Skeleton className="h-5 w-14" />
            {showMetric ? <Skeleton className="h-2 w-24" /> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
