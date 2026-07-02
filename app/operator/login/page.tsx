import type { Metadata } from "next";

import { OperatorLoginForm } from "../../../components/operator/login-form";
import styles from "../../../components/operator/operator.module.css";

export const metadata: Metadata = {
  title: "Logowanie operatora | Poza Nutą",
};

export default function OperatorLoginPage() {
  return (
    <main className={styles.loginPage}>
      <section className={styles.loginCard}>
        <p className={styles.brand}>Poza Nutą</p>
        <h1>Logowanie operatora</h1>
        <p className={styles.loginIntro}>
          Zaloguj się, aby zarządzać kolejką aktywnego wydarzenia.
        </p>
        <OperatorLoginForm />
      </section>
    </main>
  );
}
