import { Skeleton } from "@/components/ui/skeleton";

export function AdminImportsSkeleton() {
  return (
    <div className="grid gap-6" aria-label="Ładowanie importów" aria-busy="true">
      <div className="grid gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-5 w-full max-w-2xl" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="ml-auto h-9 w-28" />
      </div>
      <div className="grid gap-3 border-t border-border pt-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-44 w-full" />
        ))}
      </div>
    </div>
  );
}
