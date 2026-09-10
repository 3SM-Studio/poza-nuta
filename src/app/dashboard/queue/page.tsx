import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Dashboard kolejki | Poza Nutą",
};

export default function DashboardQueuePage() {
  redirect("/dashboard");
}
