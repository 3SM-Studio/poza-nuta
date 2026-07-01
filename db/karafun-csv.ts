import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export const KARAFUN_REQUIRED_HEADERS = [
  "Id",
  "Title",
  "Artist",
  "Year",
  "Duo",
  "Explicit",
  "Date Added",
  "Styles",
  "Languages",
] as const;

export type KaraFunCsvHeader = (typeof KARAFUN_REQUIRED_HEADERS)[number];
export type KaraFunCsvRow = Record<KaraFunCsvHeader, string>;

export async function* readKaraFunCsvRows(
  inputPath: string,
): AsyncGenerator<KaraFunCsvRow> {
  const input = createReadStream(inputPath, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let headers: string[] | null = null;
  let pendingRecord = "";
  let hasPendingRecord = false;

  try {
    for await (const line of lines) {
      pendingRecord = hasPendingRecord ? `${pendingRecord}\n${line}` : line;
      hasPendingRecord = true;

      const fields = parseDelimitedRecord(pendingRecord);
      if (fields === null) {
        continue;
      }

      pendingRecord = "";
      hasPendingRecord = false;

      if (fields.every((field) => field.trim().length === 0)) {
        continue;
      }

      if (headers === null) {
        headers = fields.map((header, index) =>
          index === 0 ? header.replace(/^\uFEFF/, "").trim() : header.trim(),
        );
        validateHeaders(headers);
        continue;
      }

      yield buildRow(headers, fields);
    }
  } finally {
    lines.close();
    input.destroy();
  }

  if (hasPendingRecord) {
    throw new Error("KaraFun CSV has an unterminated quoted field.");
  }

  if (headers === null) {
    throw new Error("KaraFun CSV is empty.");
  }
}

export function parseDelimitedRecord(
  record: string,
  delimiter = ";",
): string[] | null {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < record.length; index += 1) {
    const character = record[index];
    const nextCharacter = record[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && character === delimiter) {
      fields.push(field);
      field = "";
      continue;
    }

    field += character;
  }

  if (inQuotes) {
    return null;
  }

  fields.push(field);
  return fields;
}

function validateHeaders(headers: string[]) {
  const missingHeaders = KARAFUN_REQUIRED_HEADERS.filter(
    (header) => !headers.includes(header),
  );

  if (missingHeaders.length > 0) {
    throw new Error(
      `KaraFun CSV is missing required columns: ${missingHeaders.join(", ")}.`,
    );
  }
}

function buildRow(headers: string[], fields: string[]): KaraFunCsvRow {
  const values = new Map<string, string>();

  for (const [index, header] of headers.entries()) {
    values.set(header, fields[index] ?? "");
  }

  return Object.fromEntries(
    KARAFUN_REQUIRED_HEADERS.map((header) => [
      header,
      values.get(header) ?? "",
    ]),
  ) as KaraFunCsvRow;
}
