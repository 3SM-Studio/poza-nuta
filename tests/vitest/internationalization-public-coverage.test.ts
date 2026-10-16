import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import sourceIndex from "@/i18n/source-index.json";
import uk from "@/i18n/messages/uk.json";
import en from "@/i18n/messages/en.json";
import pl from "@/i18n/messages/pl.json";

const auth = vi.hoisted(() => ({ updateSession: vi.fn(async (request: NextRequest) => NextResponse.next({ request })) }));
vi.mock("@/lib/supabase/update-session", () => auth);

describe("Ukrainian participant catalog", () => {
  it("covers every source alias used by public routes, helpers and shared UI", () => {
    const index: Record<string, string> = sourceIndex;
    const messages: Record<string, string> = uk.ui;
    const missing = new Set<string>();
    const files = readdirSync("src", { recursive: true }).map(String).map(file => file.replaceAll("\\", "/"))
      .filter(file => /\.tsx?$/.test(file) && /components\/public|components\/ui|app\/\(public\)|app\/s\/|app\/join\/|app\/layout|participant-merge-preview|request-status-badge|theme-switcher|language-switcher|lib\/participant-linking/.test(file));
    for (const file of files) {
      const tree = ts.createSourceFile(file, readFileSync(`src/${file}`, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      function walk(node: ts.Node) {
        let source: string | undefined;
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) source = node.text;
        if (ts.isTemplateExpression(node)) source = node.head.text + node.templateSpans.map((span, i) => `{v${i}}${span.literal.text}`).join("");
        if (source) {
          const key = index[source.trim().replace(/\s+/g, " ")];
          if (key && !messages[key]) missing.add(`${file}: ${source}`);
        }
        ts.forEachChild(node, walk);
      }
      walk(tree);
    }
    expect([...missing]).toEqual([]);
    for (const [key, value] of Object.entries(uk.ui)) {
      expect(key in pl.ui && key in en.ui, key).toBe(true);
      // The preserved brand may contain Polish characters; UI prose may not.
      expect(value.replaceAll("Poza Nutą", "")).not.toMatch(/[ąćęłńóśźż]/i);
    }
  });

  it("forwards the management display header without altering protected requests or Auth results", async () => {
    const { proxy } = await import("@/proxy");
    const request = new NextRequest("http://localhost/dashboard", { headers: { "x-kunestu-management-ui": "0" } });
    const response = await proxy(request);
    expect(auth.updateSession).toHaveBeenCalledWith(request);
    expect(request.headers.get("x-kunestu-management-ui")).toBe("1");
    expect(response.headers.get("x-middleware-request-x-kunestu-management-ui")).toBe("1");
  });

  it.each(["/sign-in", "/sign-up", "/setup", "/auth/invite/accept"])("adds only locale context to %s without adding an Auth operation", async path => {
    auth.updateSession.mockClear();
    const { proxy } = await import("@/proxy");
    const response = await proxy(new NextRequest(`http://localhost${path}`));
    expect(auth.updateSession).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-kunestu-management-ui")).toBe("1");
  });
});
