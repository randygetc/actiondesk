import { afterEach, describe, expect, it, vi } from "vitest";

const captureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureMessage }));
vi.mock("next/headers", () => ({ headers: vi.fn(), cookies: vi.fn() }));

const { log, REDACTED } = await import("./log");
const { requestLog, toSentry } = await import("./request-log");
const nextHeaders = await import("next/headers");

describe("toSentry (logged errors reach Sentry)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports error lines with request and workspace tags, redacted", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = toSentry(log.with({ requestId: "r1", workspaceId: "w1" }), {
      requestId: "r1",
      workspaceId: "w1",
    });
    logger
      .with({ userId: "u1" })
      .error("capture.extract_failed", { status: 500, apiKey: "x" });

    expect(captureMessage).toHaveBeenCalledWith("capture.extract_failed", {
      level: "error",
      tags: {
        event: "capture.extract_failed",
        requestId: "r1",
        workspaceId: "w1",
      },
      extra: {
        requestId: "r1",
        workspaceId: "w1",
        userId: "u1",
        status: 500,
        apiKey: REDACTED,
      },
    });
  });

  it("doesn't report info or warn lines", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    captureMessage.mockClear();
    const logger = toSentry(log);
    logger.info("x");
    logger.warn("y");
    expect(captureMessage).not.toHaveBeenCalled();
  });
});

describe("requestLog", () => {
  afterEach(() => vi.restoreAllMocks());

  it("binds the request id and a well-formed workspace id, also for Sentry", async () => {
    const ws = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
    vi.mocked(nextHeaders.headers).mockResolvedValue(
      new Headers({ "x-request-id": "req-12345678" }) as never,
    );
    vi.mocked(nextHeaders.cookies).mockResolvedValue({
      get: () => ({ value: ws }),
    } as never);
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((l) => lines.push(l));
    captureMessage.mockClear();

    (await requestLog()).error("x.failed");

    expect(JSON.parse(lines[0])).toMatchObject({
      requestId: "req-12345678",
      workspaceId: ws,
    });
    expect(captureMessage.mock.calls[0][1].tags).toMatchObject({
      requestId: "req-12345678",
      workspaceId: ws,
    });
  });

  it("falls back to the plain logger outside a request", async () => {
    vi.mocked(nextHeaders.headers).mockRejectedValue(new Error("no request"));
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((l) => lines.push(l));

    (await requestLog()).info("x.ok");

    expect(JSON.parse(lines[0])).toMatchObject({ event: "x.ok" });
    expect(JSON.parse(lines[0])).not.toHaveProperty("requestId");
  });
});
