"use client";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type CloseEventConfirmationProps = {
  id: string;
  open: boolean;
  isConfirming: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function CloseEventConfirmation({
  id,
  open,
  isConfirming,
  onCancel,
  onConfirm,
}: CloseEventConfirmationProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isConfirming) {
          onCancel();
        }
      }}
    >
      <AlertDialogContent id={id} data-management-theme="true">
        <AlertDialogHeader>
          <AlertDialogTitle>Potwierdź zamknięcie eventu</AlertDialogTitle>
          <AlertDialogDescription>
          Zamknięcie eventu ukryje aktywną sesję i zablokuje nowe zgłoszenia.
          Kolejka i historia zostaną zachowane.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isConfirming}>Anuluj</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={isConfirming}
          >
            {isConfirming ? "Zamykanie…" : "Tak, zamknij event"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
