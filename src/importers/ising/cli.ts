import { loadISingImporterConfig } from "./config.ts";
import { importISingSongs, ISingImportStoppedError } from "./importISingSongs.ts";

try {
  const config = await loadISingImporterConfig();
  const report = await importISingSongs(config);

  console.log("iSing import completed");
  console.log(`Found from API: ${report.totalFoundFromApi ?? 0}`);
  console.log(`Imported: ${report.importedCount}`);
  console.log(`Pages: ${report.pageCount}`);
  console.log(`Output: ${config.outputSongsPath}`);
} catch (error) {
  if (error instanceof ISingImportStoppedError) {
    console.error("iSing import stopped safely");
    console.error(`Reason: ${error.reason}`);
    console.error(`URL: ${error.url}`);
    console.error("No further requests were made");
    process.exitCode = 1;
  } else if (error instanceof Error) {
    console.error("iSing import failed");
    console.error(`Reason: ${error.message}`);
    process.exitCode = 1;
  } else {
    console.error("iSing import failed");
    console.error("Reason: Unknown error");
    process.exitCode = 1;
  }
}
