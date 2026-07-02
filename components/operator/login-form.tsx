"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { loginOperator, OperatorClientError } from "./api";
import styles from "./operator.module.css";

export function OperatorLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await loginOperator({ email, password });
      setPassword("");
      router.replace("/dashboard/queue");
      router.refresh();
    } catch (caughtError) {
      setError(getLoginErrorMessage(caughtError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className={styles.loginForm} onSubmit={handleSubmit}>
      <div className={styles.field}>
        <label htmlFor="operator-email">E-mail</label>
        <input
          id="operator-email"
          name="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={isSubmitting}
          required
          autoFocus
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="operator-password">Hasło</label>
        <input
          id="operator-password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={isSubmitting}
          required
          minLength={6}
        />
      </div>

      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}

      <button
        className={`${styles.button} ${styles.primaryButton} ${styles.loginButton}`}
        type="submit"
        disabled={isSubmitting}
      >
        {isSubmitting ? "Logowanie…" : "Zaloguj się"}
      </button>
    </form>
  );
}

function getLoginErrorMessage(error: unknown) {
  if (error instanceof OperatorClientError) {
    switch (error.code) {
      case "INVALID_CREDENTIALS":
        return "Nieprawidłowy adres e-mail lub hasło.";
      case "AUTH_RATE_LIMITED":
        return "Zbyt wiele prób logowania. Spróbuj ponownie później.";
      case "OPERATOR_NOT_LINKED":
        return "To konto nie jest powiązane z operatorem.";
      case "OPERATOR_INACTIVE":
        return "To konto operatora jest nieaktywne.";
      default:
        return "Nie udało się zalogować. Spróbuj ponownie.";
    }
  }

  return "Nie udało się zalogować. Spróbuj ponownie.";
}
