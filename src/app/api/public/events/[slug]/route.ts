import {
  jsonResponse,
  publicApiErrorResponse,
} from "../../../../../server/public-api/responses";
import { getPublicEventBySlug } from "../../../../../server/public-api/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await context.params;
    const event = await getPublicEventBySlug(slug, "public.events.detail");

    return jsonResponse({ event });
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
