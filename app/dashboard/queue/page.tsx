import type { Metadata } from "next";

import { OperatorQueuePanel } from "../../../components/operator/operator-queue";
import styles from "../../../components/operator/operator.module.css";

export const metadata: Metadata = {
  title: "Dashboard kolejki | Poza Nutą",
};

export default function DashboardQueuePage() {
  return (
    <main className={styles.queuePage}>
      <OperatorQueuePanel />
    </main>
  );
}
