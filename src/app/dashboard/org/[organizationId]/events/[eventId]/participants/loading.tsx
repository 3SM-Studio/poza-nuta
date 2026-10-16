import { Skeleton } from "@/components/ui/skeleton";

export default function LoadingParticipants() {
  return <div role="status" aria-label="Wczytywanie uczestników"><Skeleton className="h-72 w-full" /></div>;
}
