
import { useUiText } from "@/i18n/use-ui-text";
import styles from "@/components/public/public.module.css";

export default function PublicEventLoading() {
  const tx = useUiText();

  return (
    <main className={styles.publicPage}>
      <div className={styles.eventShell}>
        <section className={styles.publicSection}>
          <p className={styles.statusMessage}>{tx("Ładowanie wydarzenia...")}</p>
        </section>
      </div>
    </main>
  );
}
