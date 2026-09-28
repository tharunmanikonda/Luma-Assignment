import { NextResponse } from "next/server";
import { newRequestId } from "./ids";
import { toErrorEnvelope } from "./errors";

export function jsonOk<T>(body: T, init?: ResponseInit) {
  return NextResponse.json(body, init);
}

export function withApiErrors(
  handler: (requestId: string) => Promise<Response>
) {
  return async function apiRoute() {
    const requestId = newRequestId();

    try {
      const response = await handler(requestId);
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
