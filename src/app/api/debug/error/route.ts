// Step 3.8: throws on purpose, to check Sentry receives server errors with a
// readable stack trace. Only outside production; 404 in production.
export const dynamic = "force-dynamic";

function failOnPurpose(): never {
  throw new Error("Sentry test error (server, /api/debug/error)");
}

export function GET() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_DEBUG_ERROR !== "1"
  ) {
    return new Response("Not found", { status: 404 });
  }
  failOnPurpose();
}
