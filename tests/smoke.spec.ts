import { expect, test } from "@playwright/test";

test("renders the source mapping workbench shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Pembaca Website & GitHub" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Project registry" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Website preview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Source candidate" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Upload repository ZIP" })).toBeVisible();
});

test("registry fields can be edited", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Repository URL").fill("https://github.com/Scyrptoeth/example-project");
  await page.getByLabel("Branch / ref").fill("develop");

  await expect(page.getByText("https://github.com/Scyrptoeth/example-project")).toBeVisible();
  await expect(page.getByText("develop")).toBeVisible();
});

test("mobile layout does not create horizontal overflow", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Pembaca Website & GitHub" })).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );

  expect(hasHorizontalOverflow).toBe(false);
});
