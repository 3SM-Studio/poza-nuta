"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  getSignupPasswordRequirementStates,
  isStrongSignupPassword,
} from "../../lib/signup-password";
import { createClient as createSupabaseBrowserClient } from "../../lib/supabase/client";
import styles from "./operator.module.css";

type FieldErrors = Record<string, string>;

export function PlatformSetupSignupForm() {
  const [setupToken, setSetupToken] = useState("");
  const [email, setEmail] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(false);

    const errors = validateInviteForm({ setupToken, email });

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      await requestSetup("/api/setup/invite", {
        setupToken,
        email,
      });

      setSetupToken("");
      setSuccess(true);
    } catch {
      setError("Nie udalo sie wyslac zaproszenia. Sprobuj ponownie.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (success) {
    return (
      <section className={styles.signupConfirmation} role="status">
        <h2>Sprawdz email</h2>
        <p>
          Jesli token i email sa poprawne, wyslalismy link do konfiguracji.
        </p>
      </section>
    );
  }

  return (
    <form className={styles.loginForm} onSubmit={handleSubmit} noValidate>
      <div className={styles.field}>
        <label htmlFor="setup-invite-token">Token konfiguracji</label>
        <input
          id="setup-invite-token"
          name="setupToken"
          type="password"
          autoComplete="off"
          value={setupToken}
          onChange={(event) => setSetupToken(event.target.value)}
          disabled={isSubmitting}
          required
          autoFocus
        />
        <FieldError message={fieldErrors.setupToken} />
      </div>

      <div className={styles.field}>
        <label htmlFor="setup-email">Email</label>
        <input
          id="setup-email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={isSubmitting}
          required
        />
        <FieldError message={fieldErrors.email} />
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
        {isSubmitting ? "Wysylanie..." : "Wyslij link konfiguracyjny"}
      </button>
    </form>
  );
}

export function PlatformSetupFinalizeForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceHandle, setWorkspaceHandle] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const passwordRequirements = getSignupPasswordRequirementStates(password);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const errors = validateFinalizeForm({
      password,
      confirmPassword,
      setupToken,
      displayName,
      workspaceName,
      workspaceHandle,
    });

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: passwordError } = await supabase.auth.updateUser({
        password,
      });

      if (passwordError) {
        throw new Error("Password update failed.");
      }

      await requestSetup("/api/setup/finalize", {
        setupToken,
        displayName,
        workspaceName,
        workspaceHandle,
      });

      setPassword("");
      setConfirmPassword("");
      setSetupToken("");
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setSetupToken("");
      setPassword("");
      setConfirmPassword("");
      setError("Nie udalo sie zakonczyc konfiguracji.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className={styles.loginForm} onSubmit={handleSubmit} noValidate>
      <div className={styles.field}>
        <label htmlFor="setup-password">Haslo</label>
        <input
          id="setup-password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={isSubmitting}
          minLength={8}
          required
          autoFocus
        />
        <FieldError message={fieldErrors.password} />
        <ul
          className={styles.passwordRequirements}
          aria-label="Wymagania hasla"
        >
          {passwordRequirements.map((requirement) => (
            <li key={requirement.id} data-met={requirement.met}>
              {requirement.label}
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.field}>
        <label htmlFor="setup-confirm-password">Potwierdz haslo</label>
        <input
          id="setup-confirm-password"
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

      <div className={styles.field}>
        <label htmlFor="setup-token">Token konfiguracji</label>
        <input
          id="setup-token"
          name="setupToken"
          type="password"
          autoComplete="off"
          value={setupToken}
          onChange={(event) => setSetupToken(event.target.value)}
          disabled={isSubmitting}
          required
        />
        <FieldError message={fieldErrors.setupToken} />
      </div>

      <div className={styles.field}>
        <label htmlFor="setup-display-name">Imie i nazwisko</label>
        <input
          id="setup-display-name"
          name="displayName"
          type="text"
          autoComplete="name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          disabled={isSubmitting}
          required
        />
        <FieldError message={fieldErrors.displayName} />
      </div>

      <div className={styles.field}>
        <label htmlFor="setup-workspace-name">Nazwa organizacji</label>
        <input
          id="setup-workspace-name"
          name="workspaceName"
          type="text"
          value={workspaceName}
          onChange={(event) => setWorkspaceName(event.target.value)}
          disabled={isSubmitting}
          required
        />
        <FieldError message={fieldErrors.workspaceName} />
      </div>

      <div className={styles.field}>
        <label htmlFor="setup-workspace-handle">Identyfikator organizacji</label>
        <input
          id="setup-workspace-handle"
          name="workspaceHandle"
          type="text"
          value={workspaceHandle}
          onChange={(event) => setWorkspaceHandle(event.target.value)}
          disabled={isSubmitting}
          required
        />
        <FieldError message={fieldErrors.workspaceHandle} />
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
        {isSubmitting ? "Konfigurowanie..." : "Zakoncz konfiguracje"}
      </button>
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

function validateInviteForm(input: {
  setupToken: string;
  email: string;
}) {
  const errors: FieldErrors = {};
  const email = input.email.trim();

  if (!input.setupToken.trim()) {
    errors.setupToken = "Podaj token konfiguracji.";
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Podaj poprawny email.";
  }

  return errors;
}

function validateFinalizeForm(input: {
  password: string;
  confirmPassword: string;
  setupToken: string;
  displayName: string;
  workspaceName: string;
  workspaceHandle: string;
}) {
  const errors: FieldErrors = {};

  if (!isStrongSignupPassword(input.password)) {
    errors.password = "Haslo nie spelnia wymagan.";
  }

  if (input.password !== input.confirmPassword) {
    errors.confirmPassword = "Hasla musza byc takie same.";
  }

  if (!input.setupToken.trim()) {
    errors.setupToken = "Podaj token konfiguracji.";
  }

  if (input.displayName.trim().length < 2) {
    errors.displayName = "Podaj imie i nazwisko.";
  }

  if (!input.workspaceName.trim()) {
    errors.workspaceName = "Podaj nazwe organizacji.";
  }

  if (
    !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(
      input.workspaceHandle.trim().toLowerCase(),
    )
  ) {
    errors.workspaceHandle = "Podaj poprawny identyfikator.";
  }

  return errors;
}

async function requestSetup(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const responseBody = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error("Setup request failed.");
  }

  return responseBody as { status?: "signed_in" | "check_email" };
}
