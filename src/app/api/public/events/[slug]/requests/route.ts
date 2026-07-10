import {
  invalidJsonResponse,
  jsonResponse,
  publicApiErrorResponse,
  validationErrorResponse,
} from "../../../../../../server/public-api/responses";
import { createPublicRequestForEventSlug } from "../../../../../../server/public-api/service";
import { validatePublicRequestInput } from "../../../../../../server/public-api/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return invalidJsonResponse();
  }

  const validation = validatePublicRequestInput(body);

  if (!validation.success) {
    return validationErrorResponse(validation.issues);
  }

  try {
    const { slug } = await context.params;
    const createdRequest = await createPublicRequestForEventSlug(
      slug,
      validation.data,
    );

    return jsonResponse({ request: createdRequest }, 201);
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
