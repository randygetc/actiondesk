import { expect, test } from "@playwright/test";

import { signInAsNewUser } from "./helpers/auth";
import { inviteLink, newUser } from "./helpers/workspace";

test("owner invites a viewer, who joins read-only, then is promoted to member", async ({
  browser,
  baseURL,
}) => {
  const a = await newUser(browser, baseURL!);
  const b = await newUser(browser, baseURL!);

  const path = await inviteLink(a.page, "Team", b.email, "viewer");
  await expect(
    a.page.getByRole("list", { name: "Open invites" }),
  ).toContainText(b.email);

  // A adds a task in Team (it's A's current workspace after creating it).
  await a.page.goto("/tasks");
  await expect(a.page.getByTestId("workspace-name")).toHaveText("Team");
  await a.page.getByLabel("New task title").fill("Team kickoff");
  await a.page.getByRole("button", { name: "Add task" }).click();
  await expect(a.page.getByText("Team kickoff")).toBeVisible();

  // B opens the link and accepts.
  await b.page.goto(path);
  await expect(
    b.page.getByText("invited to Team as a viewer (read only)"),
  ).toBeVisible();
  await b.page.getByRole("button", { name: "Accept invite" }).click();
  await expect(b.page.getByTestId("workspace-name")).toHaveText("Team");
  await expect(b.page.getByText("Team kickoff")).toBeVisible();
  await expect(
    b.page.getByText("You can view Team but not edit it."),
  ).toBeVisible();
  await expect(b.page.getByLabel("New task title")).toHaveCount(0);
  await expect(
    b.page.getByRole("checkbox", { name: /Complete Team kickoff/ }),
  ).toHaveCount(0);

  // The invite is used; A's open list no longer shows it.
  await a.page.goto("/workspace");
  await expect(a.page.getByRole("list", { name: "Open invites" })).toHaveCount(
    0,
  );
  const members = a.page.getByRole("list", { name: "Members" });
  await expect(members.getByRole("listitem")).toHaveCount(2);

  // A promotes B; B can now add tasks.
  const bRow = members
    .getByRole("listitem")
    .filter({ hasNot: a.page.getByText("(you)") });
  await Promise.all([
    a.page.waitForResponse((r) => r.request().method() === "POST"),
    bRow.getByLabel("Role").selectOption("member"),
  ]);
  await b.page.goto("/tasks");
  await b.page.getByLabel("New task title").fill("Viewer no more");
  await b.page.getByRole("button", { name: "Add task" }).click();
  await expect(b.page.getByText("Viewer no more")).toBeVisible();
});

test("an invite link works once, for the invited email only", async ({
  browser,
  baseURL,
}) => {
  const a = await newUser(browser, baseURL!);
  const b = await newUser(browser, baseURL!);
  const c = await newUser(browser, baseURL!);
  const path = await inviteLink(a.page, "Private", b.email, "member");

  await c.page.goto(path);
  await expect(
    c.page
      .getByRole("alert")
      .filter({ hasText: "for a different email address" }),
  ).toBeVisible();
  await expect(c.page.getByText("Private")).toHaveCount(0);

  await b.page.goto(path);
  await b.page.getByRole("button", { name: "Accept invite" }).click();
  await expect(b.page.getByTestId("workspace-name")).toHaveText("Private");

  await b.page.goto(path);
  await expect(
    b.page.getByRole("alert").filter({ hasText: "already been used" }),
  ).toBeVisible();
});

test("a signed-out visitor is sent to login and back to the invite", async ({
  browser,
  baseURL,
}) => {
  const a = await newUser(browser, baseURL!);
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  // B's email is only known after sign-up, so sign up first, then drop the session.
  const { email } = await signInAsNewUser(context, baseURL!);
  const path = await inviteLink(a.page, "Team", email, "member");
  const cookies = await context.cookies();
  await context.clearCookies();

  await page.goto(path);
  await expect(page).toHaveURL(/\/login\?next=%2Finvite%2F[0-9a-f]{64}/);
  const next = new URL(page.url()).searchParams.get("next");
  expect(next).toBe(path);

  await context.addCookies(cookies);
  await page.goto(next!);
  await page.getByRole("button", { name: "Accept invite" }).click();
  await expect(page.getByTestId("workspace-name")).toHaveText("Team");
});
