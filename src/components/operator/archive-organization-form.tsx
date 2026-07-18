"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";


type ArchiveOrganizationFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  canArchive: boolean;
  organizationId: string;
  organizationName: string;
};

export function ArchiveOrganizationForm({
  action,
  canArchive,
  organizationId,
  organizationName,
}: ArchiveOrganizationFormProps) {
  const [confirmation, setConfirmation] = useState("");
  const isConfirmed = confirmation === organizationId;

  return (
    <Card className={"border-destructive/40"}>
      <CardHeader>
        <CardTitle>Strefa niebezpieczna</CardTitle>
        <CardDescription>
          To wyłączy organizację, ale nie usunie fizycznie wydarzeń, zgłoszeń
          ani członków.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className={"grid gap-4 [&_button]:justify-self-start"} action={action}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <div className={"grid gap-2 [&_input]:min-h-11 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-background [&_input]:px-3 [&_input]:py-2 [&_input]:outline-none focus-within:[&_input]:border-ring focus-within:[&_input]:ring-2 focus-within:[&_input]:ring-ring/30"}>
            <label htmlFor="archive-confirmation">
              Wpisz ID organizacji, aby potwierdzić
            </label>
            <input
              id="archive-confirmation"
              name="confirmationOrganizationId"
              type="text"
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={organizationId}
              disabled={!canArchive}
            />
          </div>
          <p className={"mt-1.5 text-sm text-muted-foreground"}>
            Organizacja: {organizationName}. Wymagane ID:{" "}
            <span className={"min-w-0 break-all [overflow-wrap:anywhere]"}>{organizationId}</span>
          </p>
          <Button
            variant="destructive"
            type="submit"
            disabled={!canArchive || !isConfirmed}
          >
            Zarchiwizuj organizację
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
