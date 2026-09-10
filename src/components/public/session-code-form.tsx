"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";
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
}: {
  destinationBasePath?: "/join";
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const complete = isCanonicalSessionCode(code);

  function updateCode(value: string) {
    const normalized = normalizeSessionCode(value);

    if (!/^\d{0,8}$/.test(normalized)) return;
    setCode(normalized);
    if (message) setMessage(null);
  }

  function pasteCode(event: ClipboardEvent<HTMLInputElement>) {
    const normalized = normalizeSessionCode(event.clipboardData.getData("text"));

    if (!/^\d{1,8}$/.test(normalized)) return;
    event.preventDefault();
    updateCode(normalized);
  }

  function submitOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeSessionCode(code);

    if (!isCanonicalSessionCode(normalized)) {
      setMessage("Wpisz osiem cyfr kodu sesji.");
      return;
    }

    setMessage(null);
    router.push(`${destinationBasePath}/${normalized}`);
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="session-code">Kod sesji</Label>
        <p id="session-code-description" className="text-sm text-muted-foreground">
          Wpisz osiem cyfr. Możesz wkleić cały kod naraz.
        </p>
        <InputOTP
          id="session-code"
          aria-label="Ośmiocyfrowy kod sesji"
          value={code}
          onChange={updateCode}
          onPaste={pasteCode}
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
          autoFocus
          containerClassName="justify-center sm:justify-start"
        >
          <InputOTPGroup>
            {[0, 1, 2, 3].map((index) => (
              <InputOTPSlot
                key={index}
                index={index}
                aria-invalid={Boolean(message)}
                className="size-10 text-base sm:size-11"
              />
            ))}
          </InputOTPGroup>
          <InputOTPSeparator />
          <InputOTPGroup>
            {[4, 5, 6, 7].map((index) => (
              <InputOTPSlot
                key={index}
                index={index}
                aria-invalid={Boolean(message)}
                className="size-10 text-base sm:size-11"
              />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </div>
      {message ? (
        <p id="session-code-error" className="text-sm text-destructive" role="alert">
          {message}
        </p>
      ) : null}
      <Button type="submit" disabled={!complete}>
        Dołącz
        <ArrowRight aria-hidden="true" />
      </Button>
    </form>
  );
}
