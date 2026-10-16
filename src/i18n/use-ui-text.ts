import { useFormatter, useTranslations } from "next-intl";
import { useMemo } from "react";
import { createUiText } from "./text";

export function useUiText() {
  const messages = useTranslations("ui");
  const formatter = useFormatter();
  return useMemo(() => createUiText(messages, formatter), [messages, formatter]);
}
