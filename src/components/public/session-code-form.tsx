"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { REGEXP_ONLY_DIGITS } from "input-otp";

import { Button } from "@/components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import {
  isCanonicalSessionCode,
  normalizeSessionCode,
  SESSION_CODE_LENGTH,
} from "@/lib/session-code";

export function SessionCodeForm({
  destinationBasePath = "/join",
  isSubmitting: externallySubmitting = false,
  onSubmitCode,
}: {
  destinationBasePath?: "/join";
  isSubmitting?: boolean;
  onSubmitCode?: (code: string) => Promise<void> | void;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const complete = isCanonicalSessionCode(code);
  const isPending = externallySubmitting || isSubmitting;

  function updateCode(value: string) {
    const normalized = normalizeSessionCode(value);

    if (!/^[0-9]{0,6}$/.test(normalized)) return;
    setCode(normalized);
    if (message) setMessage(null);
  }

  function pasteCode(event: ClipboardEvent<HTMLDivElement>) {
    // Stop input-otp's own paste handler before it can truncate an invalid code.
    event.preventDefault();
    event.stopPropagation();
    const normalized = normalizeSessionCode(event.clipboardData.getData("text/plain"));

    if (!isCanonicalSessionCode(normalized)) {
      setCode("");
      setMessage("Wpisz dokładnie 6 cyfr kodu sesji.");
      return;
    }

    updateCode(normalized);
  }

  function submitOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || externallySubmitting) return;
    const normalized = normalizeSessionCode(code);

    if (!isCanonicalSessionCode(normalized)) {
      setMessage("Wpisz dokładnie 6 cyfr kodu sesji.");
      return;
    }

    submittingRef.current = true;
    setMessage(null);
    setIsSubmitting(true);
    try {
      if (onSubmitCode) {
        await onSubmitCode(normalized);
      } else {
        router.push(`${destinationBasePath}/${normalized}`);
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
      <div className="flex flex-col items-center gap-3">
        <Label className="sr-only" htmlFor="session-code">
          Kod sesji
        </Label>
        <div className="w-fit" onPasteCapture={pasteCode}>
          <InputOTP
            id="session-code"
            aria-label="Sześciocyfrowy kod sesji"
            value={code}
            onChange={updateCode}
            onKeyDown={submitOnEnter}
            autoComplete="one-time-code"
            inputMode="numeric"
            enterKeyHint="go"
            maxLength={SESSION_CODE_LENGTH}
            pattern={REGEXP_ONLY_DIGITS}
            aria-describedby={
              message
                ? "session-code-description session-code-error"
                : "session-code-description"
            }
            aria-invalid={Boolean(message)}
            aria-busy={isPending}
            autoFocus
            containerClassName="justify-center"
          >
            <InputOTPGroup>
              {[0, 1, 2].map((index) => (
                <InputOTPSlot
                  key={index}
                  index={index}
                  aria-invalid={Boolean(message)}
                  className="size-11 text-lg sm:size-14 sm:text-2xl"
                />
              ))}
            </InputOTPGroup>
            <InputOTPSeparator />
            <InputOTPGroup>
              {[3, 4, 5].map((index) => (
                <InputOTPSlot
                  key={index}
                  index={index}
                  aria-invalid={Boolean(message)}
                  className="size-11 text-lg sm:size-14 sm:text-2xl"
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>
        <p
          id="session-code-description"
          className="text-center text-sm text-muted-foreground"
        >
          Wpisz dokładnie 6 cyfr. Możesz wkleić cały kod naraz.
        </p>
      </div>
      {message ? (
        <p
          id="session-code-error"
          className="text-center text-sm text-destructive"
          role="alert"
        >
          {message}
        </p>
      ) : null}
      <Button
        className="h-12 w-full rounded-full font-extrabold"
        type="submit"
        disabled={!complete || isPending}
      >
        {isPending ? "Łączymy…" : "Dołącz"}
        {!isPending ? <ArrowRight aria-hidden="true" /> : null}
      </Button>
    </form>
  );
}
