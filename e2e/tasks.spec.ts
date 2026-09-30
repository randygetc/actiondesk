import { expect, test, type Page } from "@playwright/test";
import { Temporal } from "temporal-polyfill";

import { signInAsNewUser } from "./helpers/auth";

// New profiles default to America/Los_Angeles.
const today = () => Temporal.Now.plainDateISO("America/Los_Angeles").toString();

const section = (page: Page, name: string) =>
  page.getByRole("region", { name });

async function createTask(page: Page, title: string, dueDate?: string) {
  await page.goto("/tasks");
  await page.getByLabel("New task title").fill(title);
  if (dueDate) await page.getByLabel("Due date").fill(dueDate);
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("link", { name: title })).toBeVisible();
}

test.beforeEach(async ({ context, baseURL }) => {
  await signInAsNewUser(context, baseURL!);
});

test("a task due today appears under Today, and completing it moves it to Done", async ({
  page,
}) => {
  await createTask(page, "Write report", today());
  await expect(
    section(page, "Today").getByRole("link", { name: "Write report" }),
  ).toBeVisible();

  await section(page, "Today")
    .getByRole("checkbox", { name: "Complete Write report" })
    .click();
  await expect(page.getByRole("link", { name: "Write report" })).toBeHidden();

  await page.goto("/tasks?show=done");
  await expect(
    section(page, "Done").getByRole("link", { name: "Write report" }),
  ).toBeVisible();
});

test("a task without a date goes under No date", async ({ page }) => {
  await createTask(page, "Someday");
  await expect(
    section(page, "No date").getByRole("link", { name: "Someday" }),
  ).toBeVisible();
});

test("edit a task in the dialog", async ({ page }) => {
  await createTask(page, "Draft plan");
  await page.getByRole("link", { name: "Draft plan" }).click();

  const dialog = page.getByRole("dialog", { name: "Edit task" });
  await dialog.getByLabel("Title").fill("Final plan");
  await dialog.getByLabel("Priority").selectOption("high");
  await dialog.getByLabel("Notes").fill("Check the numbers");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole("link", { name: "Final plan" })).toBeVisible();
  await expect(page.getByText("High", { exact: true })).toBeVisible();
});

test("completing a recurring task creates exactly one next occurrence", async ({
  page,
}) => {
  await createTask(page, "Standup", today());
  await page.getByRole("link", { name: "Standup" }).click();

  const dialog = page.getByRole("dialog", { name: "Edit task" });
  await dialog.getByLabel("Repeat").selectOption("daily");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Daily", { exact: true })).toBeVisible();

  await page.getByRole("checkbox", { name: "Complete Standup" }).click();
  // The completed one leaves the list and exactly one open occurrence remains.
  await expect(page.getByRole("link", { name: "Standup" })).toHaveCount(1);
  await expect(
    section(page, "Today").getByRole("link", { name: "Standup" }),
  ).toBeHidden();

  await page.goto("/tasks?show=done");
  await expect(
    section(page, "Done").getByRole("link", { name: "Standup" }),
  ).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Standup" })).toHaveCount(2);
});
