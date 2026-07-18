"use client";

import { useActionState } from "react";


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
    <form className={"grid gap-4 [&_button]:justify-self-start"} action={formAction} noValidate>
      <div className={"grid gap-2 [&_input]:min-h-11 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-background [&_input]:px-3 [&_input]:py-2 [&_input]:outline-none focus-within:[&_input]:border-ring focus-within:[&_input]:ring-2 focus-within:[&_input]:ring-ring/30"}>
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
          <p className={"m-0 text-sm leading-snug text-destructive"} role="alert">
            {state.fieldErrors.displayName}
          </p>
        ) : null}
      </div>

      {state.error ? (
        <p className={"m-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm leading-relaxed text-destructive"} role="alert">
          {state.error}
        </p>
      ) : null}

      <button
        className={`${"inline-flex min-h-11 items-center justify-center rounded-md border border-transparent px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"} ${"border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"}`}
        type="submit"
        disabled={isPending}
      >
        {isPending ? "Zapisywanie..." : "Kontynuuj"}
      </button>
    </form>
  );
}
