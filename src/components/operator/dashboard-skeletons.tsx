import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
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
        className={"mx-auto w-full min-w-0 max-w-[80rem]"}
        role="status"
        aria-label="Ładowanie organizacji"
      >
        <span className="sr-only">Ładowanie organizacji</span>
        <OverviewPageHeaderSkeleton />
        <OverviewBentoSkeleton />
      </section>
    </main>
  );
}

export function EventPageSkeleton() {
  return (
    <main className={"min-h-[calc(100vh-4.5rem)] min-w-0 bg-background text-foreground"}>
      <section
        className={"mx-auto w-full min-w-0 max-w-[72rem]"}
        role="status"
        aria-label="Ładowanie wydarzenia"
        aria-live="polite"
      >
        <span className="sr-only">Ładowanie wydarzenia</span>
        <PageHeaderSkeleton action />
        <div className={"grid min-w-0 gap-4"}>
          <WideCardSkeleton />
          <EventWorkspaceSkeleton />
        </div>
      </section>
    </main>
  );
}

export function OverviewBentoSkeleton() {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-12">
      <Card className="lg:col-span-2 xl:col-span-8">
        <CardHeader>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-64 max-w-full" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <CardAction>
            <Skeleton className="h-5 w-24" />
          </CardAction>
        </CardHeader>
        <CardContent>
          <DetailsGridSkeleton />
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-7 w-32" />
        </CardFooter>
      </Card>

      <Card className="lg:col-span-1 xl:col-span-4">
        <CardHeader>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <CardAction>
            <Skeleton className="h-5 w-24" />
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }, (_, index) => (
              <div className="rounded-lg bg-muted/50 p-3" key={index}>
                <Skeleton className="h-7 w-12" />
                <Skeleton className="mt-2 h-4 w-20 max-w-full" />
              </div>
            ))}
          </div>
        </CardContent>
        <CardFooter>
          <Skeleton className="h-4 w-40" />
        </CardFooter>
      </Card>

      <Card className="lg:col-span-1 xl:col-span-7">
        <CardHeader>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <CardAction>
            <Skeleton className="h-7 w-24" />
          </CardAction>
        </CardHeader>
        <CardContent>
          <OverviewRowsSkeleton count={3} />
        </CardContent>
      </Card>

      <Card className="lg:col-span-2 xl:col-span-5">
        <CardHeader>
          <Skeleton className="h-6 w-64 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </CardHeader>
        <CardContent>
          <OverviewRowsSkeleton count={4} showMetric />
        </CardContent>
        <CardFooter>
          <Skeleton className="h-4 w-36" />
        </CardFooter>
      </Card>

      <Card className="lg:col-span-2 xl:col-span-12">
        <CardHeader>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <CardAction>
            <Skeleton className="h-7 w-24" />
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <div className="rounded-lg bg-muted/50 p-3" key={index}>
                <Skeleton className="h-7 w-16" />
                <Skeleton className="mt-2 h-4 w-32 max-w-full" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
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

function OverviewPageHeaderSkeleton() {
  return (
    <header className="mb-6 flex min-w-0 flex-col gap-4 py-1 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 flex-col gap-2">
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-36" />
      </div>
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

function EventWorkspaceSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-52 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </CardHeader>
      <CardContent>
        <div className={"grid gap-3 lg:grid-cols-2"}>
          {Array.from({ length: 4 }, (_, index) => (
            <div
              className="rounded-lg border border-border bg-muted/30 p-3"
              key={index}
            >
              <Skeleton className="h-5 w-40 max-w-full" />
              <Skeleton className="mt-3 h-4 w-56 max-w-full" />
              <Skeleton className="mt-4 h-8 w-28" />
            </div>
          ))}
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
