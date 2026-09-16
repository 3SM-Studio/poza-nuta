import { Music } from "lucide-react";

import { cn } from "@/lib/utils";

export function SessionSongArtwork({
  className,
  decorative = true,
}: {
  className?: string;
  decorative?: boolean;
}) {
  return (
    <div
      aria-hidden={decorative || undefined}
      className={cn(
        "grid shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground",
        className,
      )}
    >
      <Music className="size-5" />
    </div>
  );
}
