"use client";

import styles from "./operator.module.css";

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
  if (!open) {
    return null;
  }

  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  return (
    <div
      id={id}
      className={styles.closeConfirmation}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <div>
        <h3 id={titleId}>Potwierdź zamknięcie eventu</h3>
        <p id={descriptionId}>
          Zamknięcie eventu ukryje aktywną sesję i zablokuje nowe zgłoszenia.
          Kolejka i historia zostaną zachowane.
        </p>
      </div>
      <div className={styles.closeConfirmationActions}>
        <button
          className={`${styles.button} ${styles.secondaryButton}`}
          type="button"
          onClick={onCancel}
          disabled={isConfirming}
        >
          Anuluj
        </button>
        <button
          className={`${styles.button} ${styles.confirmDangerButton}`}
          type="button"
          onClick={onConfirm}
          disabled={isConfirming}
        >
          {isConfirming ? "Zamykanie…" : "Tak, zamknij event"}
        </button>
      </div>
    </div>
  );
}
