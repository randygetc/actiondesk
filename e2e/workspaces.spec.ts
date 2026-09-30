import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { signInAsNewUser } from "./helpers/auth";

/** Switches via the form post, then reloads and checks the server agrees. */
async function switchTo(page: Page, name: string) {
  const value =
    (await page.getByRole("option", { name }).getAttribute("value")) ?? "";
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST"),
    page.getByLabel("Workspace").selectOption(value),
  ]);
  await page.reload();
  await expect(page.getByLabel("Workspace")).toHaveValue(value);
}

test("tasks are scoped to the current workspace", async ({
  context,
  baseURL,
  page,
}) => {
  const { supabase } = await signInAsNewUser(context, baseURL!);
  // No workspace UI until 3.3: create one with the user's own session.
  const { error } = await supabase.rpc("create_workspace", { p_name: "Team" });
  expect(error).toBeNull();

  await page.goto("/tasks");
  await expect(page.getByLabel("Workspace")).toContainText("Personal");
  await switchTo(page, "Team");

  await page.getByLabel("New task title").fill("Team only task");
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByText("Team only task")).toBeVisible();

  await switchTo(page, "Personal");
  await expect(page.getByText("Team only task")).toHaveCount(0);

  await switchTo(page, "Team");
  await expect(page.getByText("Team only task")).toBeVisible();
});

test("a workspace cookie for someone else's workspace is ignored (R-28)", async ({
  context,
  baseURL,
  page,
}) => {
  await signInAsNewUser(context, baseURL!);
  const { hostname } = new URL(baseURL!);
  await context.addCookies([
    { name: "ws", value: randomUUID(), domain: hostname, path: "/" },
  ]);
  await page.goto("/tasks");
  await expect(
    page.getByRole("heading", { level: 1, name: "Tasks" }),
  ).toBeVisible();
  await expect(page.getByLabel("Workspace")).toHaveValue(
    (await page
      .getByRole("option", { name: "Personal" })
      .getAttribute("value")) ?? "",
  );
});
