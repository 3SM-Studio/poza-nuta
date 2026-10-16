import { createFormatter, createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { resolveLocale, resolveUiLocale } from "@/i18n/locale";
import { createUiText, localizeUiRecord } from "@/i18n/text";
import pl from "@/i18n/messages/pl.json";
import en from "@/i18n/messages/en.json";
import uk from "@/i18n/messages/uk.json";
import sourceIndex from "@/i18n/source-index.json";

describe("locale negotiation", () => {
  it.each([
    ["en", "pl-PL", "en"], ["pl", "en-US", "pl"],
    [undefined, "fr-FR, en-GB;q=0.9, pl;q=0.8", "en"],
    [undefined, "en;q=0.2, pl-PL;q=0.9", "pl"],
    ["invalid", "en;q=0, pl;q=0", "en"],
    [undefined, "en;q=garbage, de;q=1.5", "en"],
    [undefined, null, "en"], ["../en", "en-US", "en"],
    [undefined, "uk-UA, en;q=0.8", "uk"], ["uk", "pl-PL", "uk"],
    ["en", "uk-UA", "en"], [undefined, "ua", "en"],
    [undefined, "pl-PL", "pl"], [undefined, "en-US", "en"],
    [undefined, "es-ES", "en"], [undefined, "ru-RU", "en"], [undefined, "ar-SA", "en"],
    [undefined, "es-ES,uk-UA;q=0.9,en;q=0.8", "uk"],
    [undefined, "uk;q=0.8,pl;q=0.8,en;q=0.7", "uk"],
    ["pl", "es-ES", "pl"], ["uk", "ar-SA", "uk"],
  ])("resolves cookie %s and header %s to %s", (cookie, header, expected) => {
    expect(resolveLocale(cookie, header)).toBe(expected);
  });
});

describe("PL/EN/UK catalogs", () => {
  it("keeps public UK preference while selecting a complete management catalog", () => {
    expect(resolveUiLocale("uk", "pl", true)).toBe("en");
    expect(resolveUiLocale("uk", "pl", false)).toBe("uk");
    expect(resolveUiLocale("pl", "uk-UA", true)).toBe("pl");
    expect(resolveUiLocale(undefined, "es-ES", true)).toBe("pl");
    expect(resolveUiLocale(undefined, null, true)).toBe("pl");
    expect(resolveUiLocale("en", "es-ES", true)).toBe("en");
    expect(resolveUiLocale(undefined, "es-ES", false)).toBe("en");
  });
  it.each([[0,"0 пісень"],[1,"1 пісня"],[2,"2 пісні"],[5,"5 пісень"],[12,"12 пісень"],[22,"22 пісні"]])("formats Ukrainian count %i", (count, expected) => {
    const messages: Record<string, Record<string,string>> = uk;
    const tx = createUiText(createTranslator({ locale: "uk", messages, namespace: "ui" }), createFormatter({ locale: "uk", timeZone: "Europe/Warsaw" }));
    expect(tx.count("song", Number(count))).toBe(expected);
  });
  it.each([
    [0, "0 utworów", "0 songs"], [1, "1 utwór", "1 song"],
    [2, "2 utwory", "2 songs"], [5, "5 utworów", "5 songs"],
    [12, "12 utworów", "12 songs"], [22, "22 utwory", "22 songs"],
  ])("uses locale plural rules for %i songs", (count, polish, english) => {
    for (const [locale, messages, expected] of [["pl", pl, polish], ["en", en, english]] as const) {
      const catalog: Record<string, Record<string, string>> = messages;
      const tx = createUiText(createTranslator({ locale, messages: catalog, namespace: "ui" }), createFormatter({ locale }));
      expect(tx.count("song", count)).toBe(expected);
    }
  });
  it("has identical keys and preserves all interpolation parameters", () => {
    expect(Object.keys(en.ui).sort()).toEqual(Object.keys(pl.ui).sort());
    expect(Object.values(sourceIndex).every(key => key in en.ui)).toBe(true);
    for (const key of Object.keys(pl.ui) as (keyof typeof pl.ui)[]) {
      const parameters = (message: string) => [...message.matchAll(/\{(v\d+|count)[},]/g)].map(match => match[1]).sort();
      expect(parameters(en.ui[key]), key).toEqual(parameters(pl.ui[key]));
      expect(en.ui[key].trim(), key).not.toBe("");
    }
  });

  it.each([["pl", pl], ["en", en], ["uk", uk]] as const)("formats every %s message without an ICU error", (locale, messages) => {
    const errors: unknown[] = [];
    const translate = createTranslator({ locale, messages, namespace: "ui", onError: error => errors.push(error) });
    for (const [key, message] of Object.entries(messages.ui)) {
      const values = { count: 2, ...Object.fromEntries([...message.matchAll(/\{(v\d+)\}/g)].map(match => [match[1], "sample"])) };
      translate(key as keyof typeof messages.ui, values);
    }
    expect(errors).toEqual([]);
  });

  it("translates pure UI templates and formats dates in Warsaw without translating their values", () => {
    const messages: Record<string, Record<string, string>> = en;
    const tx = createUiText(createTranslator({ locale: "en", messages, namespace: "ui" }), createFormatter({ locale: "en", timeZone: "Europe/Warsaw" }));
    expect(tx("Szukaj uczestnika")).toBe("Search participants");
    expect(tx("Start za 2 godz. 5 min")).toBe("Starts in 2 hr 5 min");
    const name = "Ustawienia <script>{name}</script>";
    expect(tx("Wybierz uczestnika: {v0}", { v0: name })).toContain(name);
    expect(tx.date("2026-10-16T12:00:00Z", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })).toBe("14:00");
    expect(tx.date("invalid")).toBe("—");
    expect(tx.number(1234.5)).toBe("1,234.5");
    expect(localizeUiRecord({ status: "approved", label: "Zaakceptowane" }, tx)).toEqual({ status: "approved", label: "Approved" });
  });
});
