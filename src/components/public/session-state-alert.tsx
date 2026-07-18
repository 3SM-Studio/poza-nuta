import {
  CircleAlertIcon,
  CopyXIcon,
  Clock3Icon,
  Link2OffIcon,
  ListXIcon,
  LockKeyholeIcon,
  QrCodeIcon,
  ShieldAlertIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export type SessionStateAlertKind =
  | "invalid"
  | "scheduled"
  | "closed"
  | "queue_disabled"
  | "rate_limited"
  | "duplicate_request"
  | "canonical_unavailable"
  | "qr_unavailable";

const presentations = {
  invalid: {
    icon: CircleAlertIcon,
    title: "Nieprawidłowy kod sesji",
    description: "Sprawdź ośmiocyfrowy kod i spróbuj ponownie.",
    variant: "destructive",
  },
  scheduled: {
    icon: Clock3Icon,
    title: "Sesja jeszcze nieaktywna",
    description: "Sesja jeszcze się nie rozpoczęła.",
    variant: "default",
  },
  closed: {
    icon: LockKeyholeIcon,
    title: "Sesja zakończona",
    description: "Sesja została zakończona i nie przyjmuje nowych zgłoszeń.",
    variant: "default",
  },
  queue_disabled: {
    icon: ListXIcon,
    title: "Kolejka wyłączona",
    description:
      "Zgłoszenia piosenek i publiczny podgląd kolejki są wyłączone dla tej sesji.",
    variant: "default",
  },
  rate_limited: {
    icon: ShieldAlertIcon,
    title: "Zbyt wiele prób",
    description: "Odczekaj chwilę przed kolejną próbą.",
    variant: "destructive",
  },
  duplicate_request: {
    icon: CopyXIcon,
    title: "To zgłoszenie już czeka",
    description:
      "Ta osoba ma już aktywne zgłoszenie tej piosenki. Poczekaj na decyzję operatora.",
    variant: "default",
  },
  canonical_unavailable: {
    icon: Link2OffIcon,
    title: "Adres sesji niedostępny",
    description: "Adres sesji jest chwilowo niedostępny.",
    variant: "default",
  },
  qr_unavailable: {
    icon: QrCodeIcon,
    title: "Kod QR niedostępny",
    description: "Nie udało się wygenerować kodu QR. Odśwież stronę i spróbuj ponownie.",
    variant: "destructive",
  },
} as const;

export function SessionStateAlert({ kind }: { kind: SessionStateAlertKind }) {
  const presentation = presentations[kind];
  const Icon = presentation.icon;

  return (
    <Alert variant={presentation.variant} data-session-state={kind}>
      <Icon aria-hidden="true" />
      <AlertTitle>{presentation.title}</AlertTitle>
      <AlertDescription>{presentation.description}</AlertDescription>
    </Alert>
  );
}
