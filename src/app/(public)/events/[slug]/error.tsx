"use client";

import { useUiText } from "@/i18n/use-ui-text";

import Link from "next/link";

import styles from "@/components/public/public.module.css";

export default function PublicEventError() {
  const tx = useUiText();

  return (
    <main className={styles.publicPage}>
      <div className={styles.eventShell}>
        <section className={styles.publicSection}>
          <h1>{tx("Nie udało się wczytać wydarzenia")}</h1>
          <p className={styles.errorMessage}>
            {tx("Spróbuj odświeżyć stronę za chwilę.")}</p>
          <Link className={styles.secondaryButton} href="/">
            {tx("Wróć")}</Link>
        </section>
      </div>
    </main>
  );
}
