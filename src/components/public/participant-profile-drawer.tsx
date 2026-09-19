"use client";

import type { FormEvent } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import {
  getParticipantNicknameLength,
  normalizeParticipantNickname,
  PARTICIPANT_NICKNAME_MAX_LENGTH,
} from "@/lib/participant-nickname";

type ParticipantProfileDrawerProps = {
  error: string | null;
  isOpen: boolean;
  isSaving: boolean;
  value: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onValueChange: (value: string) => void;
};

export function ParticipantProfileDrawer({
  error,
  isOpen,
  isSaving,
  value,
  onOpenChange,
  onSubmit,
  onValueChange,
}: ParticipantProfileDrawerProps) {
  return (
    <Drawer open={isOpen} onOpenChange={onOpenChange}>
      <DrawerContent className="border-border bg-popover text-foreground sm:inset-x-auto sm:left-[max(2rem,calc(50%-16rem))] sm:w-[min(calc(100%-4rem),32rem)] sm:rounded-t-2xl sm:border-x">
        <DrawerHeader className="relative px-6 pt-2 pb-1 text-center">
          <DrawerTitle className="text-xl font-extrabold tracking-[-0.035em]">Zmień swój nick</DrawerTitle>
          <DrawerClose asChild>
            <Button
              aria-label="Zamknij zmianę nicku"
              className="absolute top-3 right-4 size-9 rounded-full"
              size="icon"
              type="button"
              variant="ghost"
            >
              <X />
            </Button>
          </DrawerClose>
        </DrawerHeader>
        <form className="grid gap-1.5 px-6 pt-1 pb-[calc(1.85rem+env(safe-area-inset-bottom))]" onSubmit={onSubmit}>
          <label className="sr-only" htmlFor="participant-display-name">
            Twój nick
          </label>
          <Input
            id="participant-display-name"
            autoComplete="nickname"
            autoFocus
            aria-describedby={error ? "participant-rename-error" : undefined}
            aria-invalid={Boolean(error)}
            className="h-[3.2rem] border-border bg-secondary text-base"
            disabled={isSaving}
            enterKeyHint="done"
            onChange={(event) => onValueChange(event.target.value)}
            style={{ fontSize: "1rem" }}
            value={value}
          />
          <span className="text-right text-xs text-muted-foreground">
            {getParticipantNicknameLength(
              normalizeParticipantNickname(value).displayName,
            )}
            /{PARTICIPANT_NICKNAME_MAX_LENGTH}
          </span>
          {error ? (
            <p className="text-sm text-destructive" id="participant-rename-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="mt-1 grid grid-cols-2 gap-3">
            <DrawerClose asChild>
              <Button className="h-12 rounded-full font-extrabold" disabled={isSaving} type="button" variant="outline">
                Anuluj
              </Button>
            </DrawerClose>
            <Button className="h-12 rounded-full font-extrabold" disabled={isSaving} type="submit">
              {isSaving ? "Zapisuję…" : "Zapisz"}
            </Button>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
