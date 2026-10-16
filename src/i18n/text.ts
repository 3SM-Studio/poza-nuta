import sourceIndex from "./source-index.json";

type Values = Record<string, unknown>;
type MessageFormatter = (key: string, values?: Record<string, string | number>) => string;
type ValueFormatter = {
  dateTime(value: Date, options?: Intl.DateTimeFormatOptions): string;
  number(value: number, options?: Intl.NumberFormatOptions): string;
};
const keys: Readonly<Record<string, string>> = sourceIndex;
const patterns = Object.entries(keys).filter(([source]) => /\{v\d+\}/.test(source)).map(([source, key]) => {
  const slots: string[] = [];
  const expression = source.split(/(\{v\d+\})/).map(part => {
    if (/^\{v\d+\}$/.test(part)) { slots.push(part.slice(1, -1)); return "(.+?)"; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("");
  return { key, slots, expression: new RegExp(`^${expression}$`) };
});

export function createUiText(formatMessage: MessageFormatter, formatter: ValueFormatter) {
  function text(source: string | null | undefined, values?: Values): string {
    if (!source) return source ?? "";
    const trimmed = source.trim().replace(/\s+/g, " ");
    const key = keys[trimmed];
    let translated: string;
    if (key) {
      const parameters = values && Object.fromEntries(Object.entries(values).map(([name, value]) =>
        [name, typeof value === "number" ? value : String(value ?? "")]));
      translated = formatMessage(key, parameters);
    } else {
      // Pure legacy UI helpers still return source-language strings. Resolve only
      // complete known UI templates; callers must never pass user content here.
      const match = patterns.map(pattern => ({ pattern, match: pattern.expression.exec(trimmed) })).find(item => item.match);
      if (!match?.match) return source;
      const parameters = Object.fromEntries(match.pattern.slots.map((name, index) => [name, match.match![index + 1]]));
      translated = formatMessage(match.pattern.key, parameters);
    }
    return (source.startsWith(" ") ? " " : "") + translated + (source.endsWith(" ") ? " " : "");
  }
  return Object.assign(text, {
    date(value: string | Date | number | null | undefined, options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }) {
      if (value === null || value === undefined) return "—";
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? "—" : formatter.dateTime(date, { ...options, timeZone: "Europe/Warsaw" });
    },
    count(kind: "song" | "request" | "activeRequest" | "catalogSong", count: number) { return formatMessage(`${kind}Count`, { count }); },
    number(value: number, options?: Intl.NumberFormatOptions) { return formatter.number(value, options); },
  });
}

export type UiText = ReturnType<typeof createUiText>;

// For static UI presentation records only. Do not pass API/domain/user data.
export function localizeUiRecord<T>(record: T, text: UiText): T {
  if (typeof record === "string") return text(record) as T;
  if (Array.isArray(record)) return record.map(value => localizeUiRecord(value, text)) as T;
  if (record && typeof record === "object" && Object.getPrototypeOf(record) === Object.prototype) {
    return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, localizeUiRecord(value, text)])) as T;
  }
  return record;
}
