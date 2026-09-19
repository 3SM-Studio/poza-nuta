"use client";

import { Ban, CalendarClock, CircleAlert, Clock3, MapPin, RotateCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { PublicSessionEntryShell } from "./public-session-entry-shell";

export type PublicSessionLifecycleKind =
  | "invalid"
  | "scheduled"
  | "closed"
  | "cancelled"
  | "rate_limited"
  | "service_unavailable";

type LifecycleEvent = {
  name: string;
  venue: string | null;
  startsAt: string;
};

const copy: Record<PublicSessionLifecycleKind, { heading: string; description: string }> = {
  invalid: {
    heading: "Ta sesja nie jest dostępna",
    description: "Link mógł wygasnąć albo zostać wycofany. Użyj aktualnego kodu od organizatora.",
  },
  scheduled: {
    heading: "Jesteś we właściwym miejscu",
    description: "Karaoke jeszcze się nie rozpoczęło. Ta strona odświeży się automatycznie o czasie startu.",
  },
  closed: {
    heading: "Karaoke dobiegło końca",
    description: "Ta sesja nie przyjmuje już zgłoszeń. Dzięki za wspólne śpiewanie.",
  },
  cancelled: {
    heading: "Wydarzenie zostało odwołane",
    description: "Organizator anulował tę sesję. Sprawdź u niego informacje o kolejnym terminie.",
  },
  rate_limited: {
    heading: "Zwolnijmy na chwilę",
    description: "Otrzymaliśmy zbyt wiele prób. Odczekaj moment i spróbuj ponownie.",
  },
  service_unavailable: {
    heading: "Chwilowa przerwa techniczna",
    description: "Nie możemy teraz wczytać sesji. Twoje dane są bezpieczne — spróbuj ponownie za chwilę.",
  },
};

export function PublicSessionLifecycle({ event, kind, reopenable = false }: {
  event?: LifecycleEvent;
  kind: PublicSessionLifecycleKind;
  reopenable?: boolean;
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const presentation = copy[kind];
  const Icon = kind === "scheduled" ? Clock3 : kind === "cancelled" ? Ban : CircleAlert;

  useEffect(() => {
    if (kind !== "scheduled" || !event) return;
    const startsAt = new Date(event.startsAt).getTime();
    const refreshAtStart = window.setTimeout(() => router.refresh(), Math.min(2_147_000_000, Math.max(0, startsAt - Date.now() + 250)));
    const updateCountdown = window.setInterval(() => setNow(Date.now()), 30_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible" && Date.now() >= startsAt) router.refresh();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(refreshAtStart);
      window.clearInterval(updateCountdown);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [event, kind, router]);

  const startLabel = useMemo(() => event ? formatStart(event.startsAt) : null, [event]);
  const countdown = kind === "scheduled" && event ? formatCountdown(new Date(event.startsAt).getTime() - now) : null;
  const title = event?.name ?? (kind === "invalid" ? "Nieprawidłowy link" : "Sesja karaoke");

  return (
    <PublicSessionEntryShell eyebrow={kind === "scheduled" ? "Nadchodzące karaoke" : "Poza Nutą Karaoke"} title={title} titleId="session-lifecycle-title">
      <div className="px-6 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-center sm:px-8 sm:py-8">
        <Icon aria-hidden="true" className="mx-auto size-9 text-primary" strokeWidth={1.8} />
        <h2 className="mt-3 text-balance text-2xl font-extrabold tracking-[-0.03em]">{presentation.heading}</h2>
        <p className="mx-auto mt-2 max-w-[34rem] text-pretty text-sm leading-6 text-muted-foreground">{presentation.description}</p>

        {event && (event.venue || startLabel) ? (
          <dl className="mt-5 grid gap-2 rounded-2xl bg-secondary p-4 text-left sm:grid-cols-2">
            {event.venue ? (
              <div className="grid min-w-0 grid-cols-[auto_1fr] items-center gap-x-3">
                <MapPin aria-hidden="true" className="row-span-2 size-5 shrink-0 text-primary" />
                <dt className="min-w-0 text-xs text-muted-foreground">Miejsce</dt>
                <dd className="min-w-0 truncate text-sm font-bold">{event.venue}</dd>
              </div>
            ) : null}
            {startLabel ? (
              <div className="grid min-w-0 grid-cols-[auto_1fr] items-center gap-x-3">
                <CalendarClock aria-hidden="true" className="row-span-2 size-5 shrink-0 text-primary" />
                <dt className="min-w-0 text-xs text-muted-foreground">Start</dt>
                <dd className="min-w-0 text-sm font-bold">{startLabel}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {countdown ? <p className="mt-4 text-sm font-bold text-primary" role="status">{countdown}</p> : null}
        {reopenable ? <p className="mt-4 text-sm text-muted-foreground">Organizator może jeszcze wznowić tę sesję przez krótki czas.</p> : null}

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {(kind === "scheduled" || kind === "rate_limited" || kind === "service_unavailable") ? (
            <Button className="h-12 rounded-full font-extrabold text-slate-950 sm:order-2" onClick={() => router.refresh()} type="button">
              <RotateCw aria-hidden="true" /> Spróbuj ponownie
            </Button>
          ) : null}
          <Button asChild className="h-12 rounded-full font-extrabold" variant={(kind === "scheduled" || kind === "rate_limited" || kind === "service_unavailable") ? "outline" : "default"}>
            <Link href="/join">Wpisz kod wydarzenia</Link>
          </Button>
        </div>
      </div>
    </PublicSessionEntryShell>
  );
}

function formatStart(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatCountdown(remainingMs: number) {
  if (remainingMs <= 0) return "Startujemy — odświeżamy sesję…";
  const minutes = Math.ceil(remainingMs / 60_000);
  if (minutes < 60) return `Start za ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `Start za ${hours} godz. ${rest} min` : `Start za ${hours} godz.`;
}
