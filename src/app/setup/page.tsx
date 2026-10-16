import { LanguageSwitcher } from "@/components/language-switcher";

import { getUiText } from "@/i18n/server";
import type { UiText } from "@/i18n/text";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  PlatformSetupFinalizeForm,
  PlatformSetupSignupForm,
} from "../../components/operator/setup-forms";
import { getVerifiedSetupUserFromRequest } from "../../server/setup/auth";
import { getPlatformBootstrapState } from "../../server/setup/service";

export async function generateMetadata(): Promise<Metadata> {
  const tx = await getUiText();
  return {
  title: tx("Setup | Poza Nuta"),
};
}

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const tx = await getUiText();

  const bootstrapState = await getPlatformBootstrapState();

  if (bootstrapState.state === "initialized") {
    redirect("/dashboard");
  }

  const user = await getVerifiedSetupUserFromRequest();

  return (
    <main className={"grid min-h-screen place-items-center bg-background px-4 py-8 text-foreground"}>
      <section className={"w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-lg sm:p-10 [&_h1]:text-[clamp(1.75rem,6vw,2.25rem)] [&_h1]:font-semibold [&_h1]:leading-tight"}>
        <div className="flex items-start justify-between gap-3">
        <Link
          className={"mb-3 inline-flex w-fit items-center leading-none focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"}
          href="/"
          aria-label={tx("Przejdz na strone glowna")}
        >
          <Image
            className={"block h-8 w-auto object-contain"}
            src="/brand/poza_nuta_logo-white.png"
            alt={tx("Poza Nuta")}
            width={1254}
            height={1254}
          />
        </Link>
          <LanguageSwitcher management />
        </div>
        <h1>{tx("Setup platformy")}</h1>
        {renderSetupContent(bootstrapState.state, user, tx)}
      </section>
    </main>
  );
}

function renderSetupContent(
  platformState: "uninitialized" | "inconsistent",
  user: Awaited<ReturnType<typeof getVerifiedSetupUserFromRequest>>,
  tx: UiText,
) {
  if (platformState === "inconsistent") {
    return (
      <section className={"grid gap-4 [&_h2]:text-xl [&_h2]:font-semibold [&_p]:leading-relaxed [&_p]:text-muted-foreground"} role="alert">
        <h2>{tx("Konfiguracja wymaga interwencji")}</h2>
        <p>{tx("Platforma ma czesciowe dane i nie moze zostac przejeta automatycznie.")}</p>
      </section>
    );
  }

  if (user.status !== "authenticated") {
    return <PlatformSetupSignupForm />;
  }

  if (!user.emailConfirmed) {
    return (
      <section className={"grid gap-4 [&_h2]:text-xl [&_h2]:font-semibold [&_p]:leading-relaxed [&_p]:text-muted-foreground"} role="status">
        <h2>{tx("Potwierdz email")}</h2>
        <p>{tx("Po potwierdzeniu adresu email wrocisz tutaj, aby zakonczyc setup.")}</p>
      </section>
    );
  }

  return <PlatformSetupFinalizeForm />;
}
