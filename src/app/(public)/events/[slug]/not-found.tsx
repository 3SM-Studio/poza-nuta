import Link from "next/link";

import styles from "@/components/public/public.module.css";

export default function PublicEventNotFound() {
  return (
    <main className={styles.publicPage}>
      <div className={styles.eventShell}>
        <section className={styles.publicSection}>
          <h1>Nie znaleziono wydarzenia</h1>
          <p className={styles.inlineMessage}>
            Wydarzenie może być prywatne, nieopublikowane albo usunięte z
            publicznego katalogu.
          </p>
          <Link className={styles.secondaryButton} href="/">
            Wróć
          </Link>
        </section>
      </div>
    </main>
  );
}
