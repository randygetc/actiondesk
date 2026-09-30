import { expect, test, type WebSocketRoute } from "@playwright/test";

import { newUser, shareWorkspace } from "./helpers/workspace";

test("a member sees another member's new task within 2 s, without reloading", async ({
  browser,
  baseURL,
}) => {
  const a = await newUser(browser, baseURL!);
  const b = await newUser(browser, baseURL!);
  await shareWorkspace(a, b, "Live team");

  // Both on the task list; wait until B's channel is joined.
  await a.page.goto("/tasks");
  await expect(
    b.page.getByRole("img", { name: "Live updates on" }),
  ).toBeVisible();

  await a.page.getByLabel("New task title").fill("Appears live");
  await a.page.getByRole("button", { name: "Add task" }).click();
  await expect(a.page.getByText("Appears live")).toBeVisible();
  await expect(b.page.getByText("Appears live")).toBeVisible({
    timeout: 2_000,
  });

  // A's own optimistic update and the realtime echo don't duplicate the row.
  await a.page.waitForTimeout(1_000);
  await expect(a.page.getByText("Appears live")).toHaveCount(1);
  await expect(b.page.getByText("Appears live")).toHaveCount(1);

  // Completing it on B's side shows up on A's side too. The 2 s KICKOFF bar is
  // the create above; this extra check allows 5 s because parallel e2e runs
  // share one dev server, where a page refresh alone can take over 2 s.
  await b.page.getByRole("checkbox", { name: "Complete Appears live" }).click();
  await expect(a.page.getByText("Appears live")).toHaveCount(0, {
    timeout: 5_000,
  });
});

test("after the connection drops (laptop sleep), the list catches up", async ({
  browser,
  baseURL,
}) => {
  const a = await newUser(browser, baseURL!);
  const b = await newUser(browser, baseURL!);
  await shareWorkspace(a, b, "Sleepy team");

  // Route B's Realtime socket so "sleep" really drops it and refuses reconnects.
  // (Playwright's setOffline leaves an open WebSocket alone.)
  let asleep = false;
  const sockets = new Set<WebSocketRoute>();
  await b.context.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    if (asleep) return void ws.close();
    ws.connectToServer();
    sockets.add(ws);
  });
  await b.page.goto("/tasks");
  await expect(
    b.page.getByRole("img", { name: "Live updates on" }),
  ).toBeVisible();
  await a.page.goto("/tasks");

  asleep = true;
  for (const ws of sockets) await ws.close();
  await expect(
    b.page.getByRole("img", { name: "Live updates reconnecting" }),
  ).toBeVisible();

  await a.page.getByLabel("New task title").fill("Added while asleep");
  await a.page.getByRole("button", { name: "Add task" }).click();
  await expect(a.page.getByText("Added while asleep")).toBeVisible();
  // The event was really missed.
  await b.page.waitForTimeout(1_500);
  await expect(b.page.getByText("Added while asleep")).toHaveCount(0);

  asleep = false;
  await expect(
    b.page.getByRole("img", { name: "Live updates on" }),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(b.page.getByText("Added while asleep")).toBeVisible({
    timeout: 5_000,
  });
});

test("an outsider's page never shows the workspace's tasks", async ({
  browser,
  baseURL,
}) => {
  const a = await newUser(browser, baseURL!);
  const b = await newUser(browser, baseURL!);
  const outsider = await newUser(browser, baseURL!);
  await shareWorkspace(a, b, "Closed team");
  await outsider.page.goto("/tasks");
  await expect(
    outsider.page.getByRole("img", { name: "Live updates on" }),
  ).toBeVisible();

  await a.page.goto("/tasks");
  await a.page.getByLabel("New task title").fill("Members only");
  await a.page.getByRole("button", { name: "Add task" }).click();
  await expect(b.page.getByText("Members only")).toBeVisible({
    timeout: 2_000,
  });
  await outsider.page.waitForTimeout(1_500);
  await expect(outsider.page.getByText("Members only")).toHaveCount(0);
});
