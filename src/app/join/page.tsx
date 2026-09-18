import type { Metadata } from "next";
import { JoinCodeGate } from "@/components/public/join-code-gate";

export const metadata: Metadata = {
  title: "Dołącz do sesji | Poza Nutą",
};

export default async function JoinPage({
  searchParams,
}: {
  searchParams?: Promise<{ joinError?: string }>;
}) {
  const joinError = (await searchParams)?.joinError;

  return <JoinCodeGate joinError={joinError} />;
}
