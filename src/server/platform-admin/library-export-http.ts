import "server-only";

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";

import { operatorApiErrorResponse } from "@/server/operator-api/responses";

import type { PlatformPermission } from "./policy";
import {
  libraryExportMimeType,
  removeLibraryExportFile,
  type GeneratedLibraryExport,
} from "./library-export";

export const libraryExportPermission =
  "catalog_import_history.read" satisfies PlatformPermission;

export async function prepareAuthorizedLibraryExport(input: {
  requireAccess: (permission: PlatformPermission) => Promise<unknown>;
  generateExport: () => Promise<GeneratedLibraryExport>;
}) {
  await input.requireAccess(libraryExportPermission);
  return input.generateExport();
}

export async function handleLibraryExportRequest(input: {
  requireAccess: (permission: PlatformPermission) => Promise<unknown>;
  generateExport: () => Promise<GeneratedLibraryExport>;
  createResponse?: (
    generated: GeneratedLibraryExport,
  ) => Promise<Response>;
}) {
  let generated: GeneratedLibraryExport | undefined;
  try {
    generated = await prepareAuthorizedLibraryExport(input);
    return await (input.createResponse ?? createLibraryExportResponse)(generated);
  } catch (error) {
    if (generated) await removeLibraryExportFile(generated.path);
    return operatorApiErrorResponse(error);
  }
}

export async function createLibraryExportResponse(
  generated: GeneratedLibraryExport,
  dependencies: {
    openReadStream?: (path: string) => Readable;
    createResponse?: (
      body: ReadableStream<Uint8Array>,
      init: ResponseInit,
    ) => Response;
  } = {},
) {
  const file = await stat(generated.path);
  const source = (dependencies.openReadStream ?? createReadStream)(generated.path);
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () => {
    cleanupPromise ??= removeLibraryExportFile(generated.path);
    return cleanupPromise;
  };
  const lifecycle = finished(source).then(cleanup, cleanup);
  void lifecycle.catch(() => {
    console.error("Library export temporary file cleanup failed.");
  });

  try {
    const body = Readable.toWeb(source) as ReadableStream<Uint8Array>;
    return (dependencies.createResponse ?? ((responseBody, init) =>
      new Response(responseBody, init)))(body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${generated.filename}"`,
        "Content-Length": file.size.toString(),
        "Content-Type": libraryExportMimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    source.destroy();
    await lifecycle;
    throw error;
  }
}
