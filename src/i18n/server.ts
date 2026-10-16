import { getFormatter, getTranslations } from "next-intl/server";
import { createUiText } from "./text";

export async function getUiText() {
  const [messages, formatter] = await Promise.all([getTranslations("ui"), getFormatter()]);
  return createUiText(messages, formatter);
}
