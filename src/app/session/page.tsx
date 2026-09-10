import { permanentRedirect } from "next/navigation";

export default function LegacySessionEntryPage() {
  permanentRedirect("/join");
}
