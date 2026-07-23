import { resolveJoinCodeResponse } from "@/server/session-api/code-resolver-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  return resolveJoinCodeResponse(request, code);
}
