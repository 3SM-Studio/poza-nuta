"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  isCanonicalSessionCode,
  normalizeSessionCode,
} from "@/lib/session-code";

export function SessionCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeSessionCode(code);

    if (!isCanonicalSessionCode(normalized)) {
      setMessage("Wpisz osiem cyfr kodu sesji.");
      return;
    }

    setMessage(null);
    router.push(`/session/${normalized}`);
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="session-code">Kod sesji</Label>
        <Input
          id="session-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoComplete="one-time-code"
          inputMode="numeric"
          enterKeyHint="go"
          maxLength={12}
          placeholder="00000000"
          aria-describedby={message ? "session-code-error" : undefined}
          aria-invalid={Boolean(message)}
          autoFocus
        />
      </div>
      {message ? (
        <p id="session-code-error" className="text-sm text-destructive" role="alert">
          {message}
        </p>
      ) : null}
      <Button type="submit">
        Otwórz sesję
        <ArrowRight aria-hidden="true" />
      </Button>
    </form>
  );
}
