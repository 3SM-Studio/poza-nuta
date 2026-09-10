"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { logoutOperator, OperatorClientError } from "./api";

export function UnauthorizedSignIn() {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogout() {
    setIsLoggingOut(true);
    setError(null);

    try {
      await logoutOperator();
      router.refresh();
    } catch (caughtError) {
      if (
        caughtError instanceof OperatorClientError &&
        caughtError.status === 401
      ) {
        router.refresh();
        return;
      }

      setError("Nie udało się wylogować. Spróbuj ponownie.");
      setIsLoggingOut(false);
    }
  }

  return (
    <>
      <h1>Brak dostępu do dashboardu</h1>
      <p className={"mt-3 mb-7 leading-relaxed text-muted-foreground"}>
        To konto jest zalogowane w Supabase, ale nie ma aktywnego dostępu
        operatora.
      </p>

      {error ? (
        <p className={"m-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm leading-relaxed text-destructive"} role="alert">
          {error}
        </p>
      ) : null}

      <button
        className={`${"inline-flex min-h-11 items-center justify-center rounded-md border border-transparent px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"} ${"border-border bg-secondary text-secondary-foreground hover:bg-secondary/80"} ${"mt-1 w-full"}`}
        type="button"
        onClick={() => void handleLogout()}
        disabled={isLoggingOut}
      >
        {isLoggingOut ? "Wylogowywanie…" : "Wyloguj"}
      </button>
    </>
  );
}
