import { expect, test } from "@playwright/test";

import { signInAsNewUser } from "./helpers/auth";

test.beforeEach(async ({ context, baseURL, page }) => {
  await signInAsNewUser(context, baseURL!);
  await page.goto("/capture");
  await expect(page.getByRole("heading", { name: "Capture" })).toBeVisible();
  const llm = await page.locator("[data-llm]").getAttribute("data-llm");
  // Never call the real API from e2e: start the dev server with LLM_FAKE=1.
  test.skip(llm !== "fake", "needs the fake model (LLM_FAKE=1 dev server)");
});

test("paste notes, review, and save only the accepted tasks", async ({
  page,
}) => {
  await page
    .getByLabel("Notes")
    .fill(
      "Standup\n- Send the deck by 2026-12-04\n- Maybe order chairs?\n- Call the venue",
    );
  await page.getByRole("button", { name: "Find tasks" }).click();

  const found = page.getByRole("list", { name: "Found tasks" });
  await expect(found.getByRole("listitem")).toHaveCount(3);

  // The low-confidence row is flagged and starts unaccepted.
  const chairs = found.getByRole("listitem", { name: "Maybe order chairs" });
  await expect(chairs.getByText("Low confidence")).toBeVisible();
  await expect(
    chairs.getByRole("checkbox", { name: "Accept" }),
  ).not.toBeChecked();

  // Edit one row, reject another.
  const deck = found.getByRole("listitem", { name: "Send the deck" });
  await expect(deck.getByLabel("Due date")).toHaveValue("2026-12-04");
  await deck.getByLabel("Title").fill("Send the final deck");
  await found
    .getByRole("listitem", { name: "Call the venue" })
    .getByRole("button", { name: "Reject" })
    .click();
  await expect(found.getByRole("listitem")).toHaveCount(2);

  // Nothing is saved before the click.
  await page.getByRole("button", { name: "Save 1 accepted" }).click();
  await expect(page.getByRole("status")).toHaveText(/Saved 1 task\./);

  await page.getByRole("link", { name: "View tasks" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Tasks" }),
  ).toBeVisible();
  await expect(page.getByText("Send the final deck")).toBeVisible();
  await expect(page.getByText("Maybe order chairs")).toHaveCount(0);
  await expect(page.getByText("Call the venue")).toHaveCount(0);
});

test("model output renders as text, not HTML", async ({ page }) => {
  await page
    .getByLabel("Notes")
    .fill("- <b>Bold</b> <img src=x onerror=alert(1)>");
  await page.getByRole("button", { name: "Find tasks" }).click();
  const row = page
    .getByRole("list", { name: "Found tasks" })
    .getByRole("listitem");
  await expect(row).toHaveCount(1);
  await expect(row.getByLabel("Title")).toHaveValue(
    "<b>Bold</b> <img src=x onerror=alert(1)>",
  );
  await expect(page.locator("b", { hasText: "Bold" })).toHaveCount(0);
  await expect(page.locator("img[src=x]")).toHaveCount(0);
});

test("a note with no tasks says so", async ({ page }) => {
  await page.getByLabel("Notes").fill("FYI the office is closed Friday.");
  await page.getByRole("button", { name: "Find tasks" }).click();
  await expect(page.getByText("No tasks found.")).toBeVisible();
});
