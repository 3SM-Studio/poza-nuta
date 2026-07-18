"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  getSignupPasswordRequirementStates,
  isStrongSignupPassword,
} from "../../lib/signup-password";
import { OperatorClientError, signupOperator } from "./api";

type FieldErrors = Partial<
  Record<"email" | "password" | "confirmPassword", string>
>;

export function OperatorSignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const passwordRequirements = getSignupPasswordRequirementStates(password);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(false);

    const nextFieldErrors = validateSignupForm({
      email,
      password,
      confirmPassword,
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
      });

      setPassword("");
      setConfirmPassword("");

      if (result.status === "signed_in") {
        router.replace("/dashboard");
        router.refresh();
        return;
      }

      setSuccess(true);
    } catch (caughtError) {
      setError(getSignupErrorMessage(caughtError));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (success) {
    return (
      <section className={"grid gap-4 [&_h2]:text-xl [&_h2]:font-semibold [&_p]:leading-relaxed [&_p]:text-muted-foreground"} role="status">
        <h2>Sprawdź email</h2>
        <p>
          Konto zostało utworzone. Sprawdź skrzynkę i potwierdź adres email.
        </p>
        <Link className={`${"inline-flex min-h-11 items-center justify-center rounded-md border border-transparent px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"} ${"border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"}`} href="/sign-in">
          Przejdź do logowania
        </Link>
      </section>
    );
  }

  return (
    <form className={"grid gap-4"} onSubmit={handleSubmit} noValidate>
      <div className={"grid gap-2 [&_label]:text-sm [&_label]:font-semibold [&_input]:min-h-12 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-background [&_input]:px-3 [&_input]:py-2 [&_input]:text-base [&_input]:outline-none focus-within:[&_input]:border-ring focus-within:[&_input]:ring-2 focus-within:[&_input]:ring-ring/30"}>
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

      <div className={"grid gap-2 [&_label]:text-sm [&_label]:font-semibold [&_input]:min-h-12 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-background [&_input]:px-3 [&_input]:py-2 [&_input]:text-base [&_input]:outline-none focus-within:[&_input]:border-ring focus-within:[&_input]:ring-2 focus-within:[&_input]:ring-ring/30"}>
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
        <ul
          className={"mt-0.5 grid list-none gap-1 p-0 text-xs leading-snug text-muted-foreground [&_li[data-met=true]]:text-foreground"}
          aria-label="Wymagania hasła"
        >
          {passwordRequirements.map((requirement) => (
            <li key={requirement.id} data-met={requirement.met}>
              {requirement.label}
            </li>
          ))}
        </ul>
      </div>

      <div className={"grid gap-2 [&_label]:text-sm [&_label]:font-semibold [&_input]:min-h-12 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-background [&_input]:px-3 [&_input]:py-2 [&_input]:text-base [&_input]:outline-none focus-within:[&_input]:border-ring focus-within:[&_input]:ring-2 focus-within:[&_input]:ring-ring/30"}>
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
        <p className={"m-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm leading-relaxed text-destructive"} role="alert">
          {error}
        </p>
      ) : null}

      <button
        className={`${"inline-flex min-h-11 items-center justify-center rounded-md border border-transparent px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"} ${"border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"} ${"mt-1 w-full"}`}
        type="submit"
        disabled={isSubmitting}
      >
        {isSubmitting ? "Tworzenie konta..." : "Załóż konto"}
      </button>

      <p className={"mt-1 text-center text-sm text-muted-foreground [&_a]:font-semibold [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline"}>
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
    <p className={"m-0 text-sm leading-snug text-destructive"} role="alert">
      {message}
    </p>
  );
}

function validateSignupForm(input: {
  email: string;
  password: string;
  confirmPassword: string;
}): FieldErrors {
  const errors: FieldErrors = {};
  const email = input.email.trim();

  if (!email) {
    errors.email = "Podaj email.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Podaj poprawny email.";
  }

  if (!input.password) {
    errors.password = "Podaj hasło.";
  } else if (!isStrongSignupPassword(input.password)) {
    errors.password = "Hasło nie spełnia wszystkich wymagań.";
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
