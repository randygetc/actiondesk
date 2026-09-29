import { expect, test } from "@playwright/test";

import { signInAsNewUser } from "./helpers/auth";

test("unauthenticated visit to /tasks redirects to /login", async ({
  page,
}) => {
  await page.goto("/tasks");
  await expect(page).toHaveURL(/\/login\?next=%2Ftasks$/);
  await expect(
    page.getByRole("button", { name: "Sign in with Google" }),
  ).toBeVisible();
});

test("/auth/callback never redirects off-site", async ({ request }) => {
  for (const next of ["https://evil.com", "//evil.com", "/\\evil.com"]) {
    const res = await request.get(
      `/auth/callback?next=${encodeURIComponent(next)}&code=x`,
      {
        maxRedirects: 0,
      },
    );
    expect(res.status()).toBe(303);
    expect(res.headers().location).toBe("/login?error=auth");
  }
});

test("signed-in user can change their time zone, and invalid zones are rejected", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsNewUser(context, baseURL!);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  const zone = page.getByLabel("Time zone");
  await expect(zone).toHaveValue("America/Los_Angeles");

  await zone.selectOption("Europe/Berlin");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await page.reload();
  await expect(page.getByLabel("Time zone")).toHaveValue("Europe/Berlin");

  // Bypass the <select> to prove the server rejects an unknown zone.
  await page.getByLabel("Time zone").evaluate((el: HTMLSelectElement) => {
    el.add(new Option("Mars/Olympus_Mons", "Mars/Olympus_Mons"));
    el.value = "Mars/Olympus_Mons";
  });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Unknown time zone")).toBeVisible();
});

test("sign-out is POST-only and clears the session", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsNewUser(context, baseURL!);

  const get = await page.request.get("/auth/signout", { maxRedirects: 0 });
  expect(get.status()).toBe(404);
  await page.goto("/tasks");
  await expect(page).toHaveURL(/\/tasks$/);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  const authCookies = (await context.cookies()).filter((c) =>
    c.name.includes("auth-token"),
  );
  expect(authCookies).toEqual([]);

  await page.goto("/tasks");
  await expect(page).toHaveURL(/\/login/);
});
