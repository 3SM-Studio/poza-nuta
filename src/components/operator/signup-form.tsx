"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { OperatorClientError, signupOperator } from "./api";
import styles from "./operator.module.css";

type FieldErrors = Partial<
  Record<"email" | "password" | "confirmPassword" | "displayName", string>
>;

export function OperatorSignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const nextFieldErrors = validateSignupForm({
      email,
      password,
      confirmPassword,
      displayName,
    });

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const result = await signupOperator({
        email,
        password,
        confirmPassword,
        displayName,
      });

      setPassword("");
      setConfirmPassword("");

      if (result.status === "signed_in") {
        router.replace("/dashboard");
        router.refresh();
        return;
      }

      setSuccess(
        "Sprawdź email, aby potwierdzić konto. Konto zostało utworzone. Możesz się zalogować.",
      );
    } catch (caughtError) {
      setError(getSignupErrorMessage(caughtError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className={styles.loginForm} onSubmit={handleSubmit} noValidate>
      <div className={styles.field}>
        <label htmlFor="signup-email">Email</label>
        <input
          id="signup-email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={isSubmitting}
          required
          autoFocus
        />
        <FieldError message={fieldErrors.email} />
      </div>

      <div className={styles.field}>
        <label htmlFor="signup-display-name">Imię lub ksywka</label>
        <input
          id="signup-display-name"
          name="displayName"
          type="text"
          autoComplete="name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          disabled={isSubmitting}
          minLength={2}
          maxLength={80}
          required
        />
        <FieldError message={fieldErrors.displayName} />
      </div>

      <div className={styles.field}>
        <label htmlFor="signup-password">Hasło</label>
        <input
          id="signup-password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={isSubmitting}
          minLength={8}
          required
        />
        <FieldError message={fieldErrors.password} />
      </div>

      <div className={styles.field}>
        <label htmlFor="signup-confirm-password">Potwierdź hasło</label>
        <input
          id="signup-confirm-password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          disabled={isSubmitting}
          minLength={8}
          required
        />
        <FieldError message={fieldErrors.confirmPassword} />
      </div>

      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className={styles.formSuccess} role="status">
          {success}
        </p>
      ) : null}

      <button
        className={`${styles.button} ${styles.primaryButton} ${styles.loginButton}`}
        type="submit"
        disabled={isSubmitting}
      >
        {isSubmitting ? "Tworzenie konta…" : "Załóż konto"}
      </button>

      <p className={styles.authSwitch}>
        Masz już konto? <Link href="/sign-in">Zaloguj się</Link>
      </p>
    </form>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }

  return (
    <p className={styles.fieldError} role="alert">
      {message}
    </p>
  );
}

function validateSignupForm(input: {
  email: string;
  password: string;
  confirmPassword: string;
  displayName: string;
}): FieldErrors {
  const errors: FieldErrors = {};
  const email = input.email.trim();
  const displayName = input.displayName.trim();

  if (!email) {
    errors.email = "Podaj email.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Podaj poprawny email.";
  }

  if (!displayName) {
    errors.displayName = "Podaj imię lub ksywkę.";
  } else if (displayName.length < 2) {
    errors.displayName = "Imię lub ksywka musi mieć co najmniej 2 znaki.";
  } else if (displayName.length > 80) {
    errors.displayName = "Imię lub ksywka może mieć maksymalnie 80 znaków.";
  }

  if (!input.password) {
    errors.password = "Podaj hasło.";
  } else if (input.password.length < 8) {
    errors.password = "Hasło musi mieć co najmniej 8 znaków.";
  }

  if (!input.confirmPassword) {
    errors.confirmPassword = "Potwierdź hasło.";
  } else if (input.confirmPassword !== input.password) {
    errors.confirmPassword = "Hasła muszą być takie same.";
  }

  return errors;
}

function getSignupErrorMessage(error: unknown) {
  if (error instanceof OperatorClientError) {
    switch (error.code) {
      case "AUTH_RATE_LIMITED":
        return "Zbyt wiele prób rejestracji. Spróbuj ponownie później.";
      case "SIGNUP_FAILED":
        return "Nie udało się utworzyć konta. Sprawdź dane i spróbuj ponownie.";
      case "AUTH_SERVICE_ERROR":
        return "Rejestracja jest chwilowo niedostępna. Spróbuj ponownie później.";
      default:
        return "Nie udało się utworzyć konta. Spróbuj ponownie.";
    }
  }

  return "Nie udało się utworzyć konta. Spróbuj ponownie.";
}
