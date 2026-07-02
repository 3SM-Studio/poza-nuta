import type { Metadata } from "next";

import { PublicRequestPage } from "../components/public/public-request-page";

export const metadata: Metadata = {
  title: "Zgłoś piosenkę | Poza Nutą",
  description: "Wyszukaj piosenkę i dodaj swoje zgłoszenie do kolejki.",
};

export default function HomePage() {
  return <PublicRequestPage />;
}
