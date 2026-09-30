import { expect, test } from "@playwright/test";

import { signInAsNewUser } from "./helpers/auth";

test("a user over the daily cap gets the limit message, in Capture and Ask", async ({
  context,
  baseURL,
  page,
}) => {
  const { supabase } = await signInAsNewUser(context, baseURL!);
  // Spend past the default $1 cap. A user can only ever add to their own usage.
  const { error } = await supabase.rpc("log_llm_usage", {
    p_feature: "extract",
    p_model: "claude-sonnet-5-5",
    p_input_tokens: 0,
    p_output_tokens: 0,
    p_cached_tokens: 0,
    p_cost_usd: 5,
    p_outcome: "ok",
    p_latency_ms: 0,
  });
  expect(error).toBeNull();

  await page.goto("/capture");
  await page.getByLabel("Notes").fill("- Send the deck");
  await page.getByRole("button", { name: "Find tasks" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "AI limit" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Ask ActionDesk" });
  await panel.getByLabel("Question").fill("What's overdue?");
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel.getByRole("alert")).toHaveText(
    "You've reached your AI limit for the last 24 hours. Try again later.",
  );
});

test("the usage page is for admins only", async ({
  context,
  baseURL,
  page,
}) => {
  await signInAsNewUser(context, baseURL!);
  await page.goto("/admin/usage");
  await expect(page.getByText("This page is for admins only.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Usage" })).toHaveCount(0);
});
