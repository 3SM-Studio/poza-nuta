"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { loginOperator, OperatorClientError } from "./api";

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
      router.replace("/dashboard");
      router.refresh();
    } catch (caughtError) {
      setError(getLoginErrorMessage(caughtError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className={"grid gap-4"} onSubmit={handleSubmit}>
      <div className={"grid gap-2 [&_label]:text-sm [&_label]:font-semibold [&_input]:min-h-12 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-background [&_input]:px-3 [&_input]:py-2 [&_input]:text-base [&_input]:outline-none focus-within:[&_input]:border-ring focus-within:[&_input]:ring-2 focus-within:[&_input]:ring-ring/30"}>
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

      <div className={"grid gap-2 [&_label]:text-sm [&_label]:font-semibold [&_input]:min-h-12 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-background [&_input]:px-3 [&_input]:py-2 [&_input]:text-base [&_input]:outline-none focus-within:[&_input]:border-ring focus-within:[&_input]:ring-2 focus-within:[&_input]:ring-ring/30"}>
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
        <p className={"m-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm leading-relaxed text-destructive"} role="alert">
          {error}
        </p>
      ) : null}

      <button
        className={`${"inline-flex min-h-11 items-center justify-center rounded-md border border-transparent px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"} ${"border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"} ${"mt-1 w-full"}`}
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
      case "OPERATOR_SUSPENDED":
        return "Dostęp do aplikacji jest zawieszony.";
      default:
        return "Nie udało się zalogować. Spróbuj ponownie.";
    }
  }

  return "Nie udało się zalogować. Spróbuj ponownie.";
}
