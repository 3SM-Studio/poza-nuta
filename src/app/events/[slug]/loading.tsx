import styles from "@/components/public/public.module.css";

export default function PublicEventLoading() {
  return (
    <main className={styles.publicPage}>
      <div className={styles.eventShell}>
        <section className={styles.publicSection}>
          <p className={styles.statusMessage}>Ładowanie wydarzenia...</p>
        </section>
      </div>
    </main>
  );
}
