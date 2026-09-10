import QRCode from "qrcode";

export const SESSION_QR_DOWNLOAD_FILENAME = "poza-nuta-session-qr.svg";
export const SESSION_QR_MIME_TYPE = "image/svg+xml;charset=utf-8";
export const SESSION_QR_BRAND_ASSET_PATH = "/brand/poza_nuta_logo-white.svg";

const QR_ERROR_CORRECTION_LEVEL = "H" as const;
const QR_MARGIN_MODULES = 4;
const BRAND_ZONE_MODULES = 9;
const BRAND_REFERENCE_TOTAL_SIZE = 45;
const BRAND_TRANSLATE_X = 18.16811881;
const BRAND_TRANSLATE_Y = 18.53895018;
const BRAND_SCALE = 0.008128652185;
const BRAND_VIEW_BOX = "0 0 1024 1024";

type BrandVector = {
  pathData: string;
  viewBox: string;
};

function readBrandVector(asset: string): BrandVector {
  const trimmed = asset.trim();
  const root = trimmed.match(/^<svg\b([^>]*)>([\s\S]*)<\/svg>$/i);
  const content = root?.[2] ?? "";
  const pathTags = [...content.matchAll(/<path\b([^>]*)\/?\s*>/gi)];
  const unsupportedContent = content
    .replace(/<\/?g\s*>/gi, "")
    .replace(/<path\b[^>]*\/?\s*>/gi, "")
    .trim();
  const pathData = pathTags[0]?.[1]?.match(/\bd=["']([^"']+)["']/i)?.[1];

  if (
    !root ||
    !new RegExp(`viewBox=["']${BRAND_VIEW_BOX}["']`).test(root[1] ?? "") ||
    pathTags.length !== 1 ||
    !pathData ||
    unsupportedContent ||
    /<(?:script|foreignObject|image|use|style)\b/i.test(content) ||
    /\bon[a-z]+\s*=|(?:href|src)\s*=|data:image|AudioLinesIcon/i.test(
      content,
    )
  ) {
    throw new Error("SESSION_QR_INVALID_BRAND_ASSET");
  }

  return { pathData, viewBox: BRAND_VIEW_BOX };
}

export async function loadSessionQrBrandVector(
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(SESSION_QR_BRAND_ASSET_PATH);
  if (!response.ok) throw new Error("SESSION_QR_BRAND_UNAVAILABLE");

  return readBrandVector(await response.text());
}

function getCenteredLogoZone(moduleCount: number) {
  const size = BRAND_ZONE_MODULES;
  const maximumSize = moduleCount - 16;
  if (size > maximumSize) throw new Error("SESSION_QR_INVALID_LOGO_ZONE");

  return {
    size,
    start: (moduleCount - size) / 2,
  };
}

function isInsideLogoZone(
  row: number,
  column: number,
  zone: { size: number; start: number },
) {
  return (
    row >= zone.start &&
    row < zone.start + zone.size &&
    column >= zone.start &&
    column < zone.start + zone.size
  );
}

function createModulesPath(
  modules: ReturnType<typeof QRCode.create>["modules"],
  zone: { size: number; start: number },
) {
  const commands: string[] = [];

  for (let row = 0; row < modules.size; row += 1) {
    let column = 0;
    while (column < modules.size) {
      while (
        column < modules.size &&
        (!modules.get(row, column) || isInsideLogoZone(row, column, zone))
      ) {
        column += 1;
      }

      const runStart = column;
      while (
        column < modules.size &&
        modules.get(row, column) &&
        !isInsideLogoZone(row, column, zone)
      ) {
        column += 1;
      }

      if (column > runStart) {
        const x = runStart + QR_MARGIN_MODULES;
        const y = row + QR_MARGIN_MODULES;
        commands.push(`M${x} ${y}h${column - runStart}v1H${x}z`);
      }
    }
  }

  return commands.join("");
}

export async function createBrandedSessionQrSvg(
  sessionUrl: string,
  brandVector?: BrandVector,
) {
  const brand = brandVector ?? (await loadSessionQrBrandVector());
  if (brand.viewBox !== BRAND_VIEW_BOX) {
    throw new Error("SESSION_QR_INVALID_BRAND_ASSET");
  }

  const qr = QRCode.create(sessionUrl, {
    errorCorrectionLevel: QR_ERROR_CORRECTION_LEVEL,
  });
  const moduleCount = qr.modules.size;
  const totalSize = moduleCount + QR_MARGIN_MODULES * 2;
  const zone = getCenteredLogoZone(moduleCount);
  const zoneOffset = QR_MARGIN_MODULES + zone.start;
  const brandReferenceOffset = (totalSize - BRAND_REFERENCE_TOTAL_SIZE) / 2;
  const brandTranslateX = brandReferenceOffset + BRAND_TRANSLATE_X;
  const brandTranslateY = brandReferenceOffset + BRAND_TRANSLATE_Y;
  const modulesPath = createModulesPath(qr.modules, zone);

  return [
    `<svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 ${totalSize} ${totalSize}" role="img">`,
    `<path data-qr-background="true" fill="#ffffff" d="M0 0h${totalSize}v${totalSize}H0z"/>`,
    `<path data-qr-modules="true" data-qr-error-correction="H" data-qr-margin="${QR_MARGIN_MODULES}" data-qr-module-count="${moduleCount}" data-qr-logo-zone-start="${zone.start}" data-qr-logo-zone-size="${zone.size}" fill="#050505" shape-rendering="crispEdges" d="${modulesPath}"/>`,
    `<rect data-qr-brand-backing="true" x="${zoneOffset}" y="${zoneOffset}" width="${zone.size}" height="${zone.size}" rx="1" fill="#ffffff"/>`,
    `<g data-qr-brand-mark="true" transform="translate(${brandTranslateX} ${brandTranslateY}) scale(${BRAND_SCALE})"><path fill="#050505" d="${brand.pathData}"/></g>`,
    "</svg>",
  ].join("");
}

export function toSessionQrSvgDataUrl(svg: string) {
  const trimmed = svg.trim();
  if (!trimmed.startsWith("<svg") || !trimmed.endsWith("</svg>")) {
    throw new Error("SESSION_QR_INVALID_SVG");
  }

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(trimmed)}`;
}

export function toStandaloneSessionQrSvg(svg: string) {
  const trimmed = svg.trim();
  if (!trimmed.startsWith("<svg") || !trimmed.endsWith("</svg>")) {
    throw new Error("SESSION_QR_INVALID_SVG");
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n${trimmed}`;
}
