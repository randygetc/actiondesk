import { expect, type Browser, type Page } from "@playwright/test";

import { signInAsNewUser } from "./auth";

/** A signed-in user in their own browser context. */
export async function newUser(browser: Browser, baseURL: string) {
  const context = await browser.newContext({ baseURL });
  const { email } = await signInAsNewUser(context, baseURL);
  return { context, page: await context.newPage(), email };
}

/** Creates a workspace in the UI (it becomes current) and returns an invite link for `email`. */
export async function inviteLink(
  page: Page,
  workspace: string,
  email: string,
  role: "member" | "viewer",
) {
  await page.goto("/workspace");
  await page.getByLabel("New workspace name").fill(workspace);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: workspace }),
  ).toBeVisible();
  await page.getByLabel("Invite email").fill(email);
  await page.getByLabel("Invite role").selectOption(role);
  await page.getByRole("button", { name: "Create invite link" }).click();
  const link = page.getByLabel("Invite link");
  await expect(link).toHaveValue(/\/invite\/[0-9a-f]{64}$/);
  return new URL(await link.inputValue()).pathname;
}

/** A creates `workspace`, invites B with `role`, and B accepts; both end up in it. */
export async function shareWorkspace(
  a: { page: Page },
  b: { page: Page; email: string },
  workspace: string,
  role: "member" | "viewer" = "member",
) {
  const path = await inviteLink(a.page, workspace, b.email, role);
  await b.page.goto(path);
  await b.page.getByRole("button", { name: "Accept invite" }).click();
  await expect(b.page.getByTestId("workspace-name")).toHaveText(workspace);
}
