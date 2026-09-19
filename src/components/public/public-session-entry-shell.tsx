import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { PublicJoinHero } from "./public-join-hero";
import styles from "./public.module.css";

export function PublicSessionEntryShell({ children, eyebrow, panelClassName, title, titleId }: {
  children: ReactNode;
  eyebrow: string;
  panelClassName?: string;
  title: string;
  titleId: string;
}) {
  return (
    <main aria-labelledby={titleId} className={cn(styles.sessionJoinGradient, styles.publicSessionTheme, "flex min-h-dvh flex-col overflow-x-hidden text-foreground")} data-public-session-theme="dark">
      <PublicJoinHero eyebrow={eyebrow} title={title} titleId={titleId} />
      <section className={cn("relative z-10 mx-auto mt-auto w-full rounded-t-3xl bg-popover text-foreground shadow-[0_-1.5rem_4rem_oklch(0_0_0_/_22%)] sm:mb-[clamp(2rem,8dvh,6rem)] sm:w-[min(calc(100%-4rem),40rem)] sm:rounded-2xl sm:shadow-[var(--shadow-panel)]", panelClassName)}>
        {children}
      </section>
    </main>
  );
}
