"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { logoutOperator, OperatorClientError } from "./api";
import styles from "./operator.module.css";

type DashboardUserMenuProps = {
  operatorName: string;
  email: string | null;
};

export function DashboardUserMenu({
  operatorName,
  email,
}: DashboardUserMenuProps) {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogout() {
    setIsLoggingOut(true);
    setError(null);

    try {
      await logoutOperator();
      router.replace("/sign-in");
      router.refresh();
    } catch (caughtError) {
      if (
        caughtError instanceof OperatorClientError &&
        caughtError.status === 401
      ) {
        router.replace("/sign-in");
        router.refresh();
        return;
      }

      setError("Nie udało się wylogować.");
      setIsLoggingOut(false);
    }
  }

  return (
    <details className={styles.userMenu}>
      <summary aria-label={`Menu użytkownika: ${operatorName}`}>
        <span className={styles.userInitial} aria-hidden="true">
          {getInitial(operatorName)}
        </span>
        <span className={styles.userSummaryText}>
          <strong>{operatorName}</strong>
          {email ? <small>{email}</small> : null}
        </span>
      </summary>

      <div className={styles.userMenuPanel}>
        <div className={styles.userMenuIdentity}>
          <strong>{operatorName}</strong>
          {email ? <span>{email}</span> : null}
        </div>

        {error ? (
          <p className={styles.userMenuError} role="alert">
            {error}
          </p>
        ) : null}

        <button
          className={`${styles.button} ${styles.secondaryButton}`}
          type="button"
          onClick={() => void handleLogout()}
          disabled={isLoggingOut}
        >
          {isLoggingOut ? "Wylogowywanie…" : "Wyloguj"}
        </button>
      </div>
    </details>
  );
}

function getInitial(name: string) {
  return name.trim().charAt(0).toLocaleUpperCase("pl-PL") || "O";
}
