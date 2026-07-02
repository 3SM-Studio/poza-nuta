"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { logoutOperator, OperatorClientError } from "./api";
import styles from "./operator.module.css";

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
      <p className={styles.loginIntro}>
        To konto jest zalogowane w Supabase, ale nie ma aktywnego dostępu
        operatora.
      </p>

      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}

      <button
        className={`${styles.button} ${styles.secondaryButton} ${styles.loginButton}`}
        type="button"
        onClick={() => void handleLogout()}
        disabled={isLoggingOut}
      >
        {isLoggingOut ? "Wylogowywanie…" : "Wyloguj"}
      </button>
    </>
  );
}
