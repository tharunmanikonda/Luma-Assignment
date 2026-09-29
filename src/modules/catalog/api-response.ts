import { NextResponse } from "next/server";
import { newRequestId } from "@/shared/ids";
import { toErrorEnvelope } from "@/shared/errors";

export function apiRoute(
  handler: (request: Request, requestId: string) => Promise<Response>
) {
  return async (request: Request) => {
    const requestId = newRequestId();
    try {
      const response = await handler(request, requestId);
      response.headers.set("x-request-id", requestId);
      return response;
    } catch (error) {
      const envelope = toErrorEnvelope(error, requestId);
      return NextResponse.json(envelope.body, {
        status: envelope.status,
        headers: { "x-request-id": requestId }
      });
    }
  };
}
