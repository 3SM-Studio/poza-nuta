
import { useUiText } from "@/i18n/use-ui-text";
import { Skeleton } from "@/components/ui/skeleton";

export default function LoadingParticipants() {
  const tx = useUiText();

  return <div role="status" aria-label={tx("Wczytywanie uczestników")}><Skeleton className="h-72 w-full" /></div>;
}
