import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { localeCookie, resolveUiLocale } from "./locale";

export default getRequestConfig(async () => {
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  const locale = resolveUiLocale(cookieStore.get(localeCookie)?.value, requestHeaders.get("accept-language"), requestHeaders.get("x-kunestu-management-ui") === "1");
  return {
    locale,
    timeZone: "Europe/Warsaw",
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
