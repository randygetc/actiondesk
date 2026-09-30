import { expect, test, type Page } from "@playwright/test";

import { signInAsNewUser } from "./helpers/auth";

let supabase: Awaited<ReturnType<typeof signInAsNewUser>>["supabase"];

test.beforeEach(async ({ context, baseURL, page }) => {
  ({ supabase } = await signInAsNewUser(context, baseURL!));
  await page.goto("/capture");
  const llm = await page.locator("[data-llm]").getAttribute("data-llm");
  // Never call the real API from e2e: start the dev server with LLM_FAKE=1.
  test.skip(llm !== "fake", "needs the fake model (LLM_FAKE=1 dev server)");
});

async function upload(
  page: Page,
  name: string,
  buffer: Buffer,
  mimeType = "text/plain",
) {
  await page
    .getByLabel("Or upload a file")
    .setInputFiles({ name, mimeType, buffer });
  await page.getByRole("button", { name: "Find tasks" }).click();
}

async function attachmentCount() {
  const { count, error } = await supabase
    .from("attachments")
    .select("id", { count: "exact", head: true });
  expect(error).toBeNull();
  return count;
}

test("a text file becomes tasks, and the file is deleted after saving", async ({
  page,
}) => {
  await upload(
    page,
    "standup.txt",
    Buffer.from("Standup\n- Send the deck by 2026-12-04\n- Call the venue"),
  );
  const found = page.getByRole("list", { name: "Found tasks" });
  await expect(found.getByRole("listitem")).toHaveCount(2);
  expect(await attachmentCount()).toBe(1);

  await page.getByRole("button", { name: "Save 2 accepted" }).click();
  await expect(page.getByRole("status")).toHaveText(/Saved 2 tasks\./);
  await expect.poll(attachmentCount).toBe(0);
});

test("discarding the review deletes the file", async ({ page }) => {
  await upload(page, "notes.txt", Buffer.from("- Book the room"));
  await expect(
    page.getByRole("list", { name: "Found tasks" }).getByRole("listitem"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Discard" }).click();
  await expect.poll(attachmentCount).toBe(0);
});

test("a renamed executable is rejected by its bytes, not its name", async ({
  page,
}) => {
  const exe = Buffer.concat([
    Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
    Buffer.alloc(64, 1),
  ]);
  await upload(page, "notes.pdf", exe, "application/pdf");
  await expect(
    page.getByRole("alert").filter({ hasText: "Unsupported file" }),
  ).toBeVisible();
  expect(await attachmentCount()).toBe(0);
});

test("a file over 10 MB is rejected by the server", async ({ page }) => {
  await upload(page, "huge.txt", Buffer.alloc(10.5 * 1024 * 1024, "a"));
  await expect(
    page.getByRole("alert").filter({ hasText: "at most 10 MB" }),
  ).toBeVisible();
  expect(await attachmentCount()).toBe(0);
});
