import { afterEach, describe, expect, it, vi } from "vitest";

import { extractTasks } from "./extract";
import { fakeClient, isFakeLlm } from "./fake";

describe("isFakeLlm (R-21)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off unless LLM_FAKE=1", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LLM_FAKE", "");
    expect(isFakeLlm()).toBe(false);
  });

  it("is on with LLM_FAKE=1 outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LLM_FAKE", "1");
    expect(isFakeLlm()).toBe(true);
  });

  it("is never on in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LLM_FAKE", "1");
    expect(isFakeLlm()).toBe(false);
  });
});

describe("fakeClient", () => {
  it("turns bullets in the note into tasks through the real pipeline", async () => {
    const tasks = [];
    for await (const e of extractTasks(fakeClient, {
      note: {
        kind: "text",
        text: "Notes\n- Send the deck by 2026-10-09\n- Maybe order chairs?\nnot a bullet",
      },
      now: new Date("2026-10-06T01:00:00Z"),
      timezone: "Asia/Manila",
      userName: "Randy",
      projects: [],
      includeOthers: false,
    })) {
      if (e.type === "task") tasks.push(e.task);
    }
    expect(tasks).toMatchObject([
      { title: "Send the deck", due_date: "2026-10-09", confidence: 0.9 },
      { title: "Maybe order chairs", due_date: null, confidence: 0.4 },
    ]);
  });
});
