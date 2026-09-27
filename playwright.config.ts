import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  use: { baseURL: process.env.PERSONA_TEST_BASE_URL || "http://localhost:3000", ...devices["Desktop Chrome"] },
  reporter: "list",
});
