import { getUiText } from "@/i18n/server";
import type { Metadata } from "next";
import { JoinCodeGate } from "@/components/public/join-code-gate";

export async function generateMetadata(): Promise<Metadata> {
  const tx = await getUiText();
  return {
  title: tx("Dołącz do sesji | Poza Nutą"),
};
}

export default async function JoinPage({
  searchParams,
}: {
  searchParams?: Promise<{ joinError?: string }>;
}) {
  const joinError = (await searchParams)?.joinError;

  return <JoinCodeGate joinError={joinError} />;
}
