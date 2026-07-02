"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { loginOperator, OperatorClientError } from "./api";
import styles from "./operator.module.css";

export function OperatorLoginForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await loginOperator({ name, pin });
      setPin("");
      router.replace("/operator/queue");
      router.refresh();
    } catch (caughtError) {
      setError(
        caughtError instanceof OperatorClientError
          ? caughtError.message
          : "Nie udało się zalogować. Spróbuj ponownie.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className={styles.loginForm} onSubmit={handleSubmit}>
      <div className={styles.field}>
        <label htmlFor="operator-name">Nazwa operatora</label>
        <input
          id="operator-name"
          name="name"
          type="text"
          autoComplete="username"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={isSubmitting}
          required
          autoFocus
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="operator-pin">PIN</label>
        <input
          id="operator-pin"
          name="pin"
          type="password"
          autoComplete="current-password"
          value={pin}
          onChange={(event) => setPin(event.target.value)}
          disabled={isSubmitting}
          required
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
