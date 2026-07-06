"use client";

import { useActionState } from "react";

import styles from "./operator.module.css";

export type OperatorProfileOnboardingState = {
  error: string | null;
  fieldErrors: {
    displayName?: string;
  };
};

type OperatorProfileOnboardingFormProps = {
  action: (
    state: OperatorProfileOnboardingState,
    formData: FormData,
  ) => Promise<OperatorProfileOnboardingState>;
};

const initialState: OperatorProfileOnboardingState = {
  error: null,
  fieldErrors: {},
};

export function OperatorProfileOnboardingForm({
  action,
}: OperatorProfileOnboardingFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form className={styles.settingsForm} action={formAction} noValidate>
      <div className={styles.dashboardField}>
        <label htmlFor="profile-display-name">Imię i nazwisko</label>
        <input
          id="profile-display-name"
          name="displayName"
          type="text"
          autoComplete="name"
          minLength={2}
          maxLength={80}
          disabled={isPending}
          required
        />
        {state.fieldErrors.displayName ? (
          <p className={styles.fieldError} role="alert">
            {state.fieldErrors.displayName}
          </p>
        ) : null}
      </div>

      {state.error ? (
        <p className={styles.formError} role="alert">
          {state.error}
        </p>
      ) : null}

      <button
        className={`${styles.button} ${styles.primaryButton}`}
        type="submit"
        disabled={isPending}
      >
        {isPending ? "Zapisywanie..." : "Kontynuuj"}
      </button>
    </form>
  );
}
