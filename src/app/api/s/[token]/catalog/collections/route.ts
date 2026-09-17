import {
  jsonResponse,
  publicApiErrorResponse,
  validationErrorResponse,
} from "@/server/public-api/responses";
import { requireSessionApiRateLimit } from "@/server/session-api/rate-limit";
import { listPublicSessionCatalogCollections } from "@/server/session-api/service";
import { validateCatalogCollectionListQuery } from "@/server/session-api/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const validation = validateCatalogCollectionListQuery(
    new URL(request.url).searchParams,
  );
  if (!validation.success) return validationErrorResponse(validation.issues);

  try {
    requireSessionApiRateLimit(request);
    const { token } = await context.params;
    return jsonResponse(
      await listPublicSessionCatalogCollections(
        token,
        validation.data.section,
      ),
    );
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
