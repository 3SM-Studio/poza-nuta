import type { Metadata } from "next";

import { DiscoveryHomePage } from "@/components/public/discovery-home-page";

export const metadata: Metadata = {
  title: "Karaoke w Polsce | Poza Nutą",
  description:
    "Odkrywaj wydarzenia karaoke w całej Polsce, sprawdzaj lokale i organizatorów.",
};

export const dynamic = "force-dynamic";

export default function HomePage() {
  return <DiscoveryHomePage />;
}
