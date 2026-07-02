import type { Metadata } from "next";

import { DashboardOverview } from "../../components/operator/dashboard-overview";
import styles from "../../components/operator/operator.module.css";

export const metadata: Metadata = {
  title: "Dashboard | Poza Nutą",
};

export default function DashboardPage() {
  return (
    <main className={styles.queuePage}>
      <DashboardOverview />
    </main>
  );
}
