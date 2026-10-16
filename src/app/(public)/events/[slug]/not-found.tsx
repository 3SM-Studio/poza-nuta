
import { useUiText } from "@/i18n/use-ui-text";
import Link from "next/link";

import styles from "@/components/public/public.module.css";

export default function PublicEventNotFound() {
  const tx = useUiText();

  return (
    <main className={styles.publicPage}>
      <div className={styles.eventShell}>
        <section className={styles.publicSection}>
          <h1>{tx("Nie znaleziono wydarzenia")}</h1>
          <p className={styles.inlineMessage}>
            {tx("Wydarzenie może być prywatne, nieopublikowane albo usunięte z publicznego katalogu.")}</p>
          <Link className={styles.secondaryButton} href="/">
            {tx("Wróć")}</Link>
        </section>
      </div>
    </main>
  );
}
