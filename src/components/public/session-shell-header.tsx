"use client";

import Image from "next/image";
import type { FormEvent } from "react";
import { ListMusic, Search, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SessionShellHeaderProps = {
  isSubmitting: boolean;
  searchTerm: string;
  showQueue: boolean;
  onOpenProfile: () => void;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  onSearchTermChange: (value: string) => void;
  onOpenQueue: () => void;
};

export function SessionShellHeader({
  isSubmitting,
  searchTerm,
  showQueue,
  onOpenProfile,
  onSearch,
  onSearchTermChange,
  onOpenQueue,
}: SessionShellHeaderProps) {
  return (
    <header className="shrink-0 border-b border-border bg-background/95 px-4 pt-[max(0.6rem,env(safe-area-inset-top))] pb-3 sm:px-8">
      <div className="flex h-11 items-center justify-between gap-4">
        <div className="leading-none">
          <Image
            className="size-11 object-contain"
            src="/brand/poza_nuta_logo-white.png"
            alt="Poza Nutą"
            width={1254}
            height={1254}
            priority
          />
        </div>
        <div className="flex items-center gap-0.5">
          {showQueue ? (
            <Button
              aria-label="Otwórz kolejkę"
              className="size-11 rounded-full lg:hidden"
              onClick={onOpenQueue}
              size="icon-lg"
              type="button"
              variant="ghost"
            >
              <ListMusic />
            </Button>
          ) : null}
          <Button
            aria-label="Zmień swój nick"
            className="size-11 rounded-full"
            onClick={onOpenProfile}
            size="icon-lg"
            type="button"
            variant="ghost"
          >
            <UserRound />
          </Button>
        </div>
      </div>

      <form className="relative mt-2" onSubmit={onSearch}>
        <label className="sr-only" htmlFor="session-song-search">
          Tytuł lub wykonawca
        </label>
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="session-song-search"
          className="h-12 rounded-xl border-border bg-secondary pl-10 text-[15px] placeholder:text-muted-foreground"
          disabled={isSubmitting}
          onChange={(event) => onSearchTermChange(event.target.value)}
          placeholder="Szukaj utworu lub wykonawcy"
          type="search"
          value={searchTerm}
        />
      </form>
    </header>
  );
}
