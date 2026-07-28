import { expect, test } from "@playwright/test";

test("health endpoint is live and not cacheable", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["cache-control"]).toBe("no-store");
  await expect(response.json()).resolves.toMatchObject({
    status: "ok",
    service: "aios-travel-crm",
  });
});

test("security headers protect public responses", async ({ request }) => {
  const response = await request.get("/api/health");
  const headers = response.headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["cross-origin-resource-policy"]).toBe("same-origin");
  expect(headers["origin-agent-cluster"]).toBe("?1");
  expect(headers["strict-transport-security"]).toContain("max-age=31536000");
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  expect(headers["content-security-policy"]).toContain("object-src 'none'");
  expect(headers["content-security-policy"]).not.toContain("'unsafe-eval'");
});

test("anonymous visitors are redirected away from the workspace", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
});

test("protected workspace redirects are private and non-cacheable", async ({
  request,
}) => {
  const response = await request.get("/", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers()["cache-control"]).toBe(
    "private, no-store, max-age=0",
  );
});

test("sign-in exposes the required credential fields", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByLabel("Email address")).toHaveAttribute(
    "type",
    "email",
  );
  await expect(page.getByLabel("Password")).toHaveAttribute("type", "password");
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Forgot your password?" }),
  ).toHaveAttribute("href", "/forgot-password");
});

test("keyboard users can skip directly to the main content", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toBeFocused();
  await skipLink.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("password recovery uses a generic request screen", async ({ page }) => {
  await page.goto("/forgot-password");
  await expect(
    page.getByRole("heading", { name: "Reset your password." }),
  ).toBeVisible();
  await expect(page.getByLabel("Work email")).toHaveAttribute("type", "email");
});

test("password update requires a recovery session", async ({ page }) => {
  await page.goto("/update-password");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("sign-up requires name, email, and a twelve-character password", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await expect(page.getByLabel("Your name")).toBeVisible();
  await expect(page.getByLabel("Work email")).toHaveAttribute("type", "email");
  await expect(page.getByLabel("Password")).toHaveAttribute("minlength", "12");
});

test("anonymous missing routes remain protected", async ({ page }) => {
  await page.goto("/this-route-does-not-exist");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
});

test("anonymous quote workspace remains protected", async ({ page }) => {
  await page.goto("/quotes");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("anonymous itinerary workspace remains protected", async ({ page }) => {
  await page.goto("/itineraries");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("anonymous trip operations remain protected", async ({ page }) => {
  await page.goto("/trips");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("anonymous team access remains protected", async ({ page }) => {
  await page.goto("/settings/team");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("invitation acceptance preserves the secure sign-in return path", async ({
  page,
}) => {
  const token = "a".repeat(43);
  await page.goto(`/auth/invite?token=${token}`);
  await expect(
    page.getByRole("heading", { name: "Join with a verified identity." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in to continue" })).toHaveAttribute(
    "href",
    `/sign-in?next=${encodeURIComponent(`/auth/invite?token=${token}`)}`,
  );
});

test("invitation links are private and non-cacheable", async ({ request }) => {
  const response = await request.get(`/auth/invite?token=${"a".repeat(43)}`);
  expect(response.headers()["cache-control"]).toBe(
    "private, no-store, max-age=0",
  );
});

test("anonymous account security remains protected", async ({ page }) => {
  await page.goto("/settings/security");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("anonymous MFA challenge returns to sign-in safely", async ({ page }) => {
  await page.goto("/auth/mfa?next=%2Fsettings%2Fsecurity");
  await expect(page).toHaveURL(
    /\/sign-in\?next=%2Fsettings%2Fsecurity$/,
  );
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
});

test("AIOS job worker is unavailable without its server credential", async ({
  request,
}) => {
  const response = await request.post("/api/internal/aios/jobs");
  expect([401, 503]).toContain(response.status());
  expect(response.headers()["cache-control"]).toContain("no-store");
});
