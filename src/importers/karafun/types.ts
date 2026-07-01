export type KaraFunCsvRow = {
  Id: string;
  Title: string;
  Artist: string;
  Year: string;
  Duo: string;
  Explicit: string;
  "Date Added": string;
  Styles: string;
  Languages: string;
};

export type KaraFunImportReport = {
  totalRows: number;
  importedCount: number;
  skippedCount: number;
  startedAt: string;
  finishedAt: string | null;
  errors: string[];
};

export type KaraFunImporterConfig = {
  inputCsvPath: string;
  outputSongsPath: string;
  outputReportPath: string;
};
