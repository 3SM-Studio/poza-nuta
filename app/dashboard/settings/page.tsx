import type { Metadata } from "next";

import { DashboardEventSettings } from "../../../components/operator/event-settings";
import styles from "../../../components/operator/operator.module.css";

export const metadata: Metadata = {
  title: "Ustawienia eventu | Poza Nutą",
};

export default function DashboardSettingsPage() {
  return (
    <main className={styles.queuePage}>
      <DashboardEventSettings />
    </main>
  );
}
