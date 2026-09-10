import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";


export const metadata: Metadata = {
  title: "Zaproszenie | Poza Nuta",
};

export const dynamic = "force-dynamic";

export default function InviteAcceptPage() {
  return (
    <main className={"grid min-h-screen place-items-center bg-background px-4 py-8 text-foreground"}>
      <section className={"w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-lg sm:p-10 [&_h1]:text-[clamp(1.75rem,6vw,2.25rem)] [&_h1]:font-semibold [&_h1]:leading-tight"}>
        <Link
          className={"mb-3 inline-flex w-fit items-center leading-none focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"}
          href="/"
          aria-label="Przejdz na strone glowna"
        >
          <Image
            className={"block h-8 w-auto object-contain"}
            src="/brand/poza_nuta_logo-white.png"
            alt="Poza Nuta"
            width={1254}
            height={1254}
          />
        </Link>
        <h1>Otrzymałeś zaproszenie do konfiguracji platformy</h1>
        <form action="/auth/confirm" method="post">
          <button
            className={`${"inline-flex min-h-11 items-center justify-center rounded-md border border-transparent px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"} ${"border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"} ${"mt-1 w-full"}`}
            type="submit"
          >
            Zaakceptuj zaproszenie
          </button>
        </form>
      </section>
    </main>
  );
}
