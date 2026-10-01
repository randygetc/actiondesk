import { expect, test, type Browser, type Page } from "@playwright/test";

import { signIn, signInAsNewUser } from "./helpers/auth";
import { totp } from "./helpers/totp";
import { newUser, shareWorkspace } from "./helpers/workspace";

// A test that needs a second code waits for the next 30 s TOTP window
// (freshCode), so the default 30 s timeout fails depending on the clock.
test.describe.configure({ timeout: 90_000 });

const usedCodes = new Set<string>();

/** A code not used before in this run (Supabase refuses a replayed code). */
async function freshCode(secret: string) {
  for (;;) {
    const code = totp(secret);
    if (!usedCodes.has(code)) {
      usedCodes.add(code);
      return code;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

/** Sets up TOTP in Settings → Security; returns the secret. */
async function enroll(page: Page) {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Set up authenticator app" }).click();
  await expect(
    page.getByRole("img", { name: "QR code for your authenticator app" }),
  ).toBeVisible();
  const secret = (await page.getByLabel("Setup key").textContent())!.trim();
  await page.getByLabel("Authentication code").fill(await freshCode(secret));
  await page.getByRole("button", { name: "Verify and turn on" }).click();
  await expect(
    page.getByText("Two-factor authentication is on."),
  ).toBeVisible();
  return secret;
}

/** The same user in a new browser, signed in with a password only (aal1). */
async function aal1Session(
  browser: Browser,
  baseURL: string,
  email: string,
  password: string,
) {
  const context = await browser.newContext({ baseURL });
  await signIn(context, baseURL, email, password);
  return { context, page: await context.newPage(), email };
}

test("set up an authenticator app, then turn it off", async ({
  context,
  baseURL,
  page,
}) => {
  await signInAsNewUser(context, baseURL!);
  const secret = await enroll(page);

  await page.goto("/settings");
  await expect(page.getByText(/Two-factor authentication is on/)).toBeVisible();
  await page.getByText("Turn off", { exact: true }).click();
  await page.getByLabel("Authentication code").fill(await freshCode(secret));
  await page.getByRole("button", { name: "Turn off two-factor" }).click();
  await expect(
    page.getByRole("button", { name: "Set up authenticator app" }),
  ).toBeVisible();
});

test("removing a member asks for a code; a wrong code is refused", async ({
  browser,
  baseURL,
}) => {
  const ownerContext = await browser.newContext({ baseURL });
  const owner = await signInAsNewUser(ownerContext, baseURL!);
  const secret = await enroll(await ownerContext.newPage());

  // A fresh password sign-in: MFA is set up, but this session is aal1.
  const a = await aal1Session(browser, baseURL!, owner.email, owner.password);
  const b = await newUser(browser, baseURL!);
  await shareWorkspace(a, b, "Team");

  await a.page.goto("/workspace");
  const members = a.page.getByRole("list", { name: "Members" });
  const bRow = members
    .getByRole("listitem")
    .filter({ hasNot: a.page.getByText("(you)") });
  await bRow.getByRole("button", { name: "Remove" }).click();
  await expect(bRow.getByRole("alert")).toHaveText(/Enter the 6-digit code/);

  await bRow.getByLabel("Authentication code").fill("000000");
  await bRow.getByRole("button", { name: "Confirm remove" }).click();
  await expect(bRow.getByRole("alert")).toHaveText(/didn't work/);
  await expect(members.getByRole("listitem")).toHaveCount(2);

  await bRow.getByLabel("Authentication code").fill(await freshCode(secret));
  await bRow.getByRole("button", { name: "Confirm remove" }).click();
  await expect(members.getByRole("listitem")).toHaveCount(1);
});

test("without two-factor, an owner can't delete a workspace", async ({
  browser,
  baseURL,
}) => {
  const a = await newUser(browser, baseURL!);
  await a.page.goto("/workspace");
  await a.page.getByLabel("New workspace name").fill("Keep me");
  await a.page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    a.page.getByRole("heading", { level: 1, name: "Keep me" }),
  ).toBeVisible();

  await a.page.getByText("Delete workspace").click();
  await a.page.getByRole("button", { name: "Delete Keep me" }).click();
  await expect(
    a.page
      .getByRole("alert")
      .filter({ hasText: "Set up an authenticator app" }),
  ).toBeVisible();
  await a.page.goto("/workspace");
  await expect(
    a.page.getByRole("heading", { level: 1, name: "Keep me" }),
  ).toBeVisible();
});

test("with a code, an owner deletes a workspace and it's gone", async ({
  browser,
  baseURL,
}) => {
  const ownerContext = await browser.newContext({ baseURL });
  const owner = await signInAsNewUser(ownerContext, baseURL!);
  const secret = await enroll(await ownerContext.newPage());
  const a = await aal1Session(browser, baseURL!, owner.email, owner.password);

  await a.page.goto("/workspace");
  await a.page.getByLabel("New workspace name").fill("Doomed");
  await a.page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    a.page.getByRole("heading", { level: 1, name: "Doomed" }),
  ).toBeVisible();

  await a.page.getByText("Delete workspace").click();
  await a.page.getByLabel("Authentication code").fill(await freshCode(secret));
  await a.page.getByRole("button", { name: "Delete Doomed" }).click();
  await expect(
    a.page.getByRole("heading", { level: 1, name: "Tasks" }),
  ).toBeVisible();
  await expect(a.page.getByTestId("workspace-name")).toHaveText("Personal");
  await expect(a.page.getByRole("option", { name: "Doomed" })).toHaveCount(0);
});
