import type { Metadata } from "next";

import { PublicQueuePage } from "../../components/public/public-queue-page";

export const metadata: Metadata = {
  title: "Publiczna kolejka | Poza Nutą",
};

export default function QueuePage() {
  return <PublicQueuePage />;
}
