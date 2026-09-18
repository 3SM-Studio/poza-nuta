"use client";

import { CircleAlert, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { PublicJoinHero } from "./public-join-hero";
import styles from "./public.module.css";
import { SessionCodeForm } from "./session-code-form";

const JOIN_TRANSITION_MS = 180;

export function JoinCodeGate({ joinError }: { joinError?: string }) {
  const router = useRouter();
  const [isTransitioning, setIsTransitioning] = useState(false);
  const isDesktop = useDesktopLayout();

  const continueToCode = useCallback(
    async (code: string) => {
      setIsTransitioning(true);
      const transitionDelay = window.matchMedia("(prefers-reduced-motion: reduce)")
        .matches
        ? 0
        : JOIN_TRANSITION_MS;

      await new Promise<void>((resolve) => {
        window.setTimeout(() => {
          router.push(`/join/${code}`);
          resolve();
        }, transitionDelay);
      });
    },
    [router],
  );

  return (
    <main
      className={`${styles.sessionJoinGradient} relative min-h-dvh overflow-hidden text-foreground`}
      aria-labelledby="join-code-title"
    >
      <PublicJoinHero
        eyebrow="Dołącz do karaoke"
        title="Wpisz kod wydarzenia"
        titleId="join-code-title"
      />

      <section
        className={cn(
          "absolute top-[48dvh] right-0 left-0 z-10 mx-auto hidden w-[min(calc(100%-4rem),40rem)] rounded-2xl border border-border bg-popover text-foreground shadow-[0_1.5rem_3rem_oklch(0_0_0_/_18%)] transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none sm:block",
          isTransitioning &&
            "pointer-events-none translate-y-6 opacity-0 motion-reduce:translate-y-0",
        )}
        aria-labelledby="join-code-panel-title"
      >
        <h2
          className="px-8 pt-5 text-center text-2xl font-extrabold tracking-[-0.035em]"
          id="join-code-panel-title"
        >
          Kod wydarzenia
        </h2>
        <JoinCodePanelBody
          isSubmitting={isTransitioning}
          joinError={joinError}
          onSubmitCode={continueToCode}
        />
      </section>

      {!isDesktop ? (
        <Drawer dismissible={false} open>
          <DrawerContent
            className={cn(
              "border-border bg-popover text-foreground transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none sm:hidden",
              isTransitioning &&
                "pointer-events-none translate-y-[calc(100%+1.5rem)] opacity-0 motion-reduce:translate-y-0",
            )}
            overlayClassName="!bg-black/10 !backdrop-blur-none sm:hidden"
          >
            <DrawerHeader className="px-6 pt-2 pb-0 text-center">
              <DrawerTitle className="text-xl font-extrabold tracking-[-0.035em]">
                Kod wydarzenia
              </DrawerTitle>
            </DrawerHeader>
            <JoinCodePanelBody
              isSubmitting={isTransitioning}
              joinError={joinError}
              onSubmitCode={continueToCode}
            />
          </DrawerContent>
        </Drawer>
      ) : null}
    </main>
  );
}

function JoinCodePanelBody({
  isSubmitting,
  joinError,
  onSubmitCode,
}: {
  isSubmitting: boolean;
  joinError?: string;
  onSubmitCode: (code: string) => Promise<void>;
}) {
  return (
    <div className="px-6 pt-1 pb-[calc(1.1rem+env(safe-area-inset-bottom))] sm:px-8 sm:pt-2 sm:pb-8">
      <p className="mb-4 text-center text-sm text-muted-foreground sm:mb-5">
        Kod znajdziesz na ekranie lub przy stoliku.
      </p>
      <SessionCodeForm
        isSubmitting={isSubmitting}
        onSubmitCode={onSubmitCode}
      />
      {joinError ? <JoinErrorAlert kind={joinError} /> : null}
    </div>
  );
}

function useDesktopLayout() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 640px)");
    const updateLayout = () => setIsDesktop(mediaQuery.matches);

    updateLayout();
    mediaQuery.addEventListener("change", updateLayout);
    return () => mediaQuery.removeEventListener("change", updateLayout);
  }, []);

  return isDesktop;
}

function JoinErrorAlert({ kind }: { kind: string }) {
  const limited = kind === "rate-limited";
  const unavailable = kind === "unavailable";
  const Icon = limited ? ShieldAlert : CircleAlert;

  return (
    <Alert className="mt-4 text-left" variant={limited ? "destructive" : "default"}>
      <Icon aria-hidden="true" />
      <AlertTitle>
        {limited
          ? "Zbyt wiele prób"
          : unavailable
            ? "Kod jest chwilowo niedostępny"
            : "Kod jest nieaktywny"}
      </AlertTitle>
      <AlertDescription>
        {limited
          ? "Odczekaj chwilę przed kolejną próbą."
          : unavailable
            ? "Spróbuj ponownie za chwilę."
            : "Sprawdź kod albo poproś organizatora o aktualny."}
      </AlertDescription>
    </Alert>
  );
}
