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

import styles from "./operator.module.css";

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
    <Card className={styles.dangerZoneCard}>
      <CardHeader>
        <CardTitle>Danger zone</CardTitle>
        <CardDescription>
          Archiving disables this organization. Events, requests and members
          remain in the database.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className={styles.settingsForm} action={action}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <div className={styles.dashboardField}>
            <label htmlFor="archive-confirmation">
              Type the organization ID to confirm
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
          <p className={styles.eventMeta}>
            Organization: {organizationName}. Required ID:{" "}
            <span className={styles.breakValue}>{organizationId}</span>
          </p>
          <Button
            variant="destructive"
            type="submit"
            disabled={!canArchive || !isConfirmed}
          >
            Archive organization
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
