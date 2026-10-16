import { getUiText } from "@/i18n/server";
import type { Metadata } from "next";

import { DiscoveryHomePage } from "@/components/public/discovery-home-page";

export async function generateMetadata(): Promise<Metadata> {
  const tx = await getUiText();
  return {
  title: tx("Karaoke w Polsce | Poza Nutą"),
  description:
    tx("Odkrywaj wydarzenia karaoke w całej Polsce, sprawdzaj lokale i organizatorów."),
};
}

export const dynamic = "force-dynamic";

export default function HomePage() {
  return <DiscoveryHomePage />;
}
