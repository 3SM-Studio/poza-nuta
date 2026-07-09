"use client";

import Link from "next/link";

import styles from "@/components/public/public.module.css";

export default function PublicEventError() {
  return (
    <main className={styles.publicPage}>
      <div className={styles.eventShell}>
        <section className={styles.publicSection}>
          <h1>Nie udało się wczytać wydarzenia</h1>
          <p className={styles.errorMessage}>
            Spróbuj odświeżyć stronę za chwilę.
          </p>
          <Link className={styles.secondaryButton} href="/">
            Wróć
          </Link>
        </section>
      </div>
    </main>
  );
}
