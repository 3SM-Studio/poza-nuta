import type { Metadata } from "next";

import { DashboardEventSettings } from "../../../components/operator/event-settings";

export const metadata: Metadata = {
  title: "Ustawienia eventu | Poza Nutą",
};

export default function DashboardSettingsPage() {
  return (
    <main className={"min-h-[calc(100vh-4.5rem)] min-w-0 bg-background text-foreground"}>
      <DashboardEventSettings />
    </main>
  );
}
