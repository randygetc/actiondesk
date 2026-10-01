import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import { scrubEvent } from "./sentry-options";

describe("scrubEvent", () => {
  it("drops bodies, cookies, query strings and headers, keeping the request id", () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        url: "https://app/tasks",
        data: '{"title":"secret plan"}',
        cookies: { "sb-access-token": "x" },
        query_string: "edit=1",
        headers: {
          authorization: "Bearer x",
          cookie: "y",
          "x-request-id": "req-1",
        },
      },
      user: { id: "u1", email: "a@b.c", ip_address: "1.2.3.4" },
    } as ErrorEvent)!;
    expect(event.request).toEqual({
      url: "https://app/tasks",
      headers: { "x-request-id": "req-1" },
    });
    expect(event.tags).toMatchObject({ requestId: "req-1" });
    expect(event.user).toEqual({ id: "u1" });
  });
});
