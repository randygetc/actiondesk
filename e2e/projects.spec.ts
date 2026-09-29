import { expect, test, type Page } from "@playwright/test";

import { signInAsNewUser } from "./helpers/auth";

async function createProject(page: Page, name: string) {
  await page.goto("/projects");
  await page.getByLabel("New project name").fill(name);
  await page.getByRole("button", { name: "Add project" }).click();
  await expect(
    page.getByRole("list", { name: "Projects" }).getByRole("link", { name }),
  ).toBeVisible();
}

async function openProject(page: Page, name: string) {
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

test.beforeEach(async ({ context, baseURL }) => {
  await signInAsNewUser(context, baseURL!);
});

test("create a project, and duplicate names are rejected case-insensitively", async ({
  page,
}) => {
  await createProject(page, "Launch");
  await expect(page.getByLabel("New project name")).toHaveValue("");

  await page.getByLabel("New project name").fill("  launch ");
  await page.getByRole("button", { name: "Add project" }).click();
  await expect(page.getByText("Name already used")).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Projects" }).getByRole("link"),
  ).toHaveCount(1);
});

test("rename a project", async ({ page }) => {
  await createProject(page, "Draft");
  await openProject(page, "Draft");

  await page.getByLabel("Name", { exact: true }).fill("Final");
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await expect(page.getByRole("heading", { name: "Final" })).toBeVisible();
});

test("archive hides a project; restore brings it back", async ({ page }) => {
  await createProject(page, "Old stuff");
  await openProject(page, "Old stuff");

  await page.getByRole("button", { name: "Archive project" }).click();
  await expect(page.getByText("Archived", { exact: true })).toBeVisible();

  await page.goto("/projects");
  await expect(page.getByText("No projects yet.")).toBeVisible();
  await page.getByRole("link", { name: "Show archived" }).click();
  await openProject(page, "Old stuff");

  await page.getByRole("button", { name: "Restore project" }).click();
  await expect(
    page.getByRole("button", { name: "Archive project" }),
  ).toBeVisible();
  await page.goto("/projects");
  await expect(page.getByRole("link", { name: "Old stuff" })).toBeVisible();
});

test("delete asks for confirmation, then removes the project", async ({
  page,
}) => {
  await createProject(page, "Doomed");
  await openProject(page, "Doomed");

  const confirm = page.getByRole("button", { name: "Yes, delete permanently" });
  await expect(confirm).toBeHidden();
  await page.getByText("Delete project…").click();
  await confirm.click();

  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByText("No projects yet.")).toBeVisible();
});

test("another user's project and bad ids are 404s", async ({
  page,
  browser,
  baseURL,
}) => {
  await createProject(page, "Private");
  await openProject(page, "Private");
  const url = page.url();

  const other = await browser.newContext({ baseURL });
  await signInAsNewUser(other, baseURL!);
  const otherPage = await other.newPage();
  expect((await otherPage.goto(url))?.status()).toBe(404);
  expect((await otherPage.goto("/projects/not-a-uuid"))?.status()).toBe(404);
  await expect(otherPage.getByText("Private")).toHaveCount(0);
  await other.close();
});

test("project tasks: add from the project, delete warns with the count and keeps the task (D-3)", async ({
  page,
}) => {
  await createProject(page, "Website");
  await openProject(page, "Website");

  await page.getByLabel("New task title").fill("Fix footer");
  await page.getByRole("button", { name: "Add task" }).click();
  const tasks = page.getByRole("region", { name: "Open tasks" });
  await expect(tasks.getByRole("link", { name: "Fix footer" })).toBeVisible();

  await page.getByText("Delete project…").click();
  await expect(
    page.getByText("Its 1 task stays, without a project."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Yes, delete permanently" }).click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto("/tasks");
  await expect(page.getByRole("link", { name: "Fix footer" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Website" })).toHaveCount(0);
});
