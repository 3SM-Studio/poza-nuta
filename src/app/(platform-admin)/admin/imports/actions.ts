"use server";

import { revalidatePath } from "next/cache";

import {
  cancelImportJobWithDependencies,
  startISingImportWithDependencies,
} from "@/server/platform-admin/import-admin-core";
import {
  enqueueImportJob,
  requestImportCancellation,
} from "@/server/platform-admin/import-jobs";

const importsPath = "/admin/imports";
const dependencies = {
  enqueue: enqueueImportJob,
  requestCancellation: requestImportCancellation,
};

export async function startISingDryRunAction() {
  const result = await startISingImportWithDependencies(
    "dry_run",
    dependencies,
  );
  revalidatePath(importsPath);
  return result;
}

export async function startISingWriteAction() {
  const result = await startISingImportWithDependencies("write", dependencies);
  revalidatePath(importsPath);
  return result;
}

export async function cancelImportJobAction(importJobId: number) {
  const result = await cancelImportJobWithDependencies(
    importJobId,
    dependencies,
  );
  revalidatePath(importsPath);
  return result;
}
