import { getUiText } from "@/i18n/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const tx = await getUiText();
  return {
  title: tx("Dashboard kolejki | Poza Nutą"),
};
}

export default function DashboardQueuePage() {
  redirect("/dashboard");
}
