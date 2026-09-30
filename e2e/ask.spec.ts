import { expect, test, type Page } from "@playwright/test";

import { signInAsNewUser } from "./helpers/auth";

async function addTask(page: Page, title: string, dueDate: string) {
  await page.goto("/tasks");
  await page.getByLabel("New task title").fill(title);
  await page.getByLabel("Due date").first().fill(dueDate);
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
}

async function openAsk(page: Page) {
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  return page.getByRole("complementary", { name: "Ask ActionDesk" });
}

async function send(panel: ReturnType<Page["getByRole"]>, question: string) {
  await panel.getByLabel("Question").fill(question);
  await panel.getByRole("button", { name: "Send" }).click();
}

test.beforeEach(async ({ context, baseURL, page }) => {
  await signInAsNewUser(context, baseURL!);
  await page.goto("/capture");
  const llm = await page.locator("[data-llm]").getAttribute("data-llm");
  // Never call the real API from e2e: start the dev server with LLM_FAKE=1.
  test.skip(llm !== "fake", "needs the fake model (LLM_FAKE=1 dev server)");
});

test("answers from a tool, shows the tool used, and renders text literally", async ({
  page,
}) => {
  await addTask(page, "<b>Old</b> report", "2020-01-15");
  const panel = await openAsk(page);
  await send(panel, "What's overdue?");

  const answer = panel
    .getByRole("listitem", { name: "Answer", exact: true })
    .last();
  await expect(answer.getByRole("list", { name: "Tools used" })).toHaveText(
    "Checked overdue tasks",
  );
  await expect(answer).toContainText("Found 1: <b>Old</b> report");
  await expect(panel.locator("b")).toHaveCount(0);
});

test("a proposed task is saved only after Confirm", async ({ page }) => {
  await page.goto("/tasks");
  const panel = await openAsk(page);
  await send(panel, "Add a task: Buy milk");

  const card = panel.getByRole("group", { name: "Proposed task: Buy milk" });
  await expect(card).toBeVisible();
  await expect(panel.getByText("I've proposed that task.")).toBeVisible();

  // Not saved yet.
  await page.reload();
  await expect(page.getByText("Buy milk")).toHaveCount(0);

  const panel2 = await openAsk(page);
  await send(panel2, "Add a task: Buy milk");
  const card2 = panel2.getByRole("group", { name: "Proposed task: Buy milk" });
  await card2.getByRole("button", { name: "Confirm" }).click();
  await expect(card2.getByRole("status")).toHaveText("Created.");

  await page.reload();
  await expect(page.getByText("Buy milk")).toBeVisible();
});

test("a dismissed proposal is never saved", async ({ page }) => {
  await page.goto("/tasks");
  const panel = await openAsk(page);
  await send(panel, "Create task: Sell the car");
  const card = panel.getByRole("group", {
    name: "Proposed task: Sell the car",
  });
  await card.getByRole("button", { name: "Dismiss" }).click();
  await expect(card.getByText("Dismissed.")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Sell the car")).toHaveCount(0);
});
