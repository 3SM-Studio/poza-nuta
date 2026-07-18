// @vitest-environment jsdom

import QRCode from "qrcode";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createBrandedSessionQrSvg,
  loadSessionQrBrandVector,
  SESSION_QR_BRAND_ASSET_PATH,
  SESSION_QR_DOWNLOAD_FILENAME,
  SESSION_QR_MIME_TYPE,
  toStandaloneSessionQrSvg,
} from "@/lib/branded-session-qr";

const SESSION_URL = "http://localhost:3000/session/01234567";
const BRAND_ASSET = readFileSync(
  resolve(process.cwd(), "public/brand/poza_nuta_logo-white.svg"),
  "utf8",
).trim();
const BRAND_PATH = BRAND_ASSET.match(/<path\s+d="([^"]+)"/)?.[1];

function readRenderedModules(svg: string) {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const modules = document.querySelector('[data-qr-modules="true"]');
  if (!modules) throw new Error("Missing QR modules");

  const margin = Number(modules.getAttribute("data-qr-margin"));
  const zoneStart = Number(modules.getAttribute("data-qr-logo-zone-start"));
  const zoneSize = Number(modules.getAttribute("data-qr-logo-zone-size"));
  const rendered = new Set<string>();
  const command = /M(\d+) (\d+)h(\d+)v1H\d+z/g;
  const path = modules.getAttribute("d") ?? "";
  let match: RegExpExecArray | null;

  while ((match = command.exec(path))) {
    const start = Number(match[1]) - margin;
    const row = Number(match[2]) - margin;
    const length = Number(match[3]);
    for (let offset = 0; offset < length; offset += 1) {
      rendered.add(`${row}:${start + offset}`);
    }
  }

  return { document, margin, rendered, zoneSize, zoneStart };
}

describe("branded session QR", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => BRAND_ASSET,
      })),
    );
  });

  it("renders the canonical URL from the H-correction module matrix", async () => {
    const create = vi.spyOn(QRCode, "create");

    const svg = await createBrandedSessionQrSvg(SESSION_URL);

    expect(create).toHaveBeenCalledWith(SESSION_URL, {
      errorCorrectionLevel: "H",
    });
    expect(svg).toContain('data-qr-error-correction="H"');
    expect(svg).toContain('data-qr-margin="4"');
    const rootTag = svg.match(/^<svg[^>]+>/)?.[0];
    expect(rootTag).toBeTruthy();
    expect(rootTag).toContain('width="1024"');
    expect(rootTag).toContain('height="1024"');
    expect(rootTag).toContain('viewBox="0 0 45 45"');
  });

  it("removes every dark module from the grid-aligned logo zone", async () => {
    const svg = await createBrandedSessionQrSvg(SESSION_URL);
    const { rendered, zoneSize, zoneStart } = readRenderedModules(svg);
    const source = QRCode.create(SESSION_URL, { errorCorrectionLevel: "H" });
    let expectedOutsideZone = 0;

    expect(Number.isInteger(zoneStart)).toBe(true);
    expect(Number.isInteger(zoneSize)).toBe(true);
    expect(zoneSize).toBe(9);

    for (let row = 0; row < source.modules.size; row += 1) {
      for (let column = 0; column < source.modules.size; column += 1) {
        const insideZone =
          row >= zoneStart &&
          row < zoneStart + zoneSize &&
          column >= zoneStart &&
          column < zoneStart + zoneSize;

        if (insideZone) {
          expect(rendered.has(`${row}:${column}`)).toBe(false);
        } else if (source.modules.get(row, column)) {
          expectedOutsideZone += 1;
          expect(rendered.has(`${row}:${column}`)).toBe(true);
        }
      }
    }

    expect(rendered.size).toBe(expectedOutsideZone);
  });

  it("keeps the backing entirely inside the already-empty module zone", async () => {
    const svg = await createBrandedSessionQrSvg(SESSION_URL);
    const { document, margin, zoneSize, zoneStart } = readRenderedModules(svg);
    const backing = document.querySelector('[data-qr-brand-backing="true"]');

    expect(Number(backing?.getAttribute("x"))).toBe(margin + zoneStart);
    expect(Number(backing?.getAttribute("y"))).toBe(margin + zoneStart);
    expect(Number(backing?.getAttribute("width"))).toBe(zoneSize);
    expect(Number(backing?.getAttribute("height"))).toBe(zoneSize);
  });

  it("flattens the exact Poza Nuta path into the root SVG", async () => {
    const svg = await createBrandedSessionQrSvg(SESSION_URL);
    const document = new DOMParser().parseFromString(svg, "image/svg+xml");
    const brand = document.querySelector('[data-qr-brand-mark="true"]');
    const generatedPath = brand?.querySelector(":scope > path");
    const transform = brand?.getAttribute("transform") ?? "";
    const transformParts = transform.match(
      /^translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)$/,
    );

    expect(BRAND_PATH).toBeTruthy();
    expect(document.querySelectorAll("svg")).toHaveLength(1);
    expect(brand?.tagName.toLowerCase()).toBe("g");
    expect(generatedPath?.getAttribute("d")).toBe(BRAND_PATH);
    expect(generatedPath?.getAttribute("fill")).toBe("#050505");
    expect(generatedPath?.hasAttribute("stroke")).toBe(false);
    expect(generatedPath?.getAttribute("fill")).not.toBe("none");
    expect(transformParts).toBeTruthy();
    expect(Number(transformParts?.[1])).toBe(18.16811881);
    expect(Number(transformParts?.[2])).toBe(18.53895018);
    expect(Number(transformParts?.[3])).toBe(0.008128652185);
    expect(Number(transformParts?.[3]) * 1024).toBeCloseTo(8.32373983744);
    expect((Number(transformParts?.[3]) * 1024) / 45).toBeCloseTo(0.185);
    expect(brand?.hasAttribute("viewBox")).toBe(false);
    expect(brand?.hasAttribute("width")).toBe(false);
    expect(brand?.hasAttribute("height")).toBe(false);
    expect(svg).not.toContain("preserveAspectRatio");
    expect(svg).not.toContain("rgba(");
    expect(svg).not.toMatch(/<image\b|data:image|AudioLinesIcon/i);
    expect(svg).not.toMatch(/(?:href|src)=["']https?:/);
  });

  it("keeps the Affinity-facing brand mark as a visible filled curve", async () => {
    const svg = await createBrandedSessionQrSvg(SESSION_URL);
    const document = new DOMParser().parseFromString(svg, "image/svg+xml");
    const brand = document.querySelector('[data-qr-brand-mark="true"]');
    const paths = brand?.querySelectorAll(":scope > path");
    const path = paths?.[0];

    expect(paths).toHaveLength(1);
    expect(path?.getAttribute("d")?.length).toBeGreaterThan(1_000);
    expect(path?.getAttribute("d")).toMatch(/^M /);
    expect(path?.getAttribute("d")).toContain(" C");
    expect(path?.getAttribute("fill")).toBe("#050505");
    expect(brand?.querySelector("rect")).toBeNull();
  });

  it("produces a standalone, raster-free SVG download", async () => {
    const svg = await createBrandedSessionQrSvg(SESSION_URL);
    const standalone = toStandaloneSessionQrSvg(svg);

    expect(standalone).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(standalone).toContain('<path data-qr-modules="true"');
    expect(standalone).toContain('<g data-qr-brand-mark="true"');
    expect(standalone.match(/<svg\b/g)).toHaveLength(1);
    expect(standalone).not.toMatch(/data:image|<image\b|<canvas\b/i);
    expect(SESSION_QR_MIME_TYPE).toBe("image/svg+xml;charset=utf-8");
    expect(SESSION_QR_DOWNLOAD_FILENAME).toBe("poza-nuta-session-qr.svg");
    expect(SESSION_QR_DOWNLOAD_FILENAME).not.toContain("01234567");
  });

  it("loads only the controlled repository vector", async () => {
    const vector = await loadSessionQrBrandVector();

    expect(fetch).toHaveBeenCalledWith(SESSION_QR_BRAND_ASSET_PATH);
    expect(vector.viewBox).toBe("0 0 1024 1024");
    expect(vector.pathData).toBe(BRAND_PATH);
    expect(vector.pathData).not.toMatch(/data:image|<image\b/i);
  });
});
