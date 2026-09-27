import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/google", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { account: null } });
    return route.fulfill({ json: { account: null } });
  });
  await page.route("**/api/conversation", async (route) => {
    const input = route.request().postDataJSON();
    const text = input.message.toLowerCase();
    const hasName = text.includes("sam");
    const hasGoal = text.includes("week") || text.includes("schedule") || text.includes("study plan");
    return route.fulfill({ json: {
      reply: input.profile.step === "assistant"
        ? "Let's turn that into a manageable plan. First, list your three priorities."
        : hasGoal && hasName
          ? "Nice to meet you, Sam. Let's pick three priorities for this week, then put each on a day. You can connect your Google account if you'd like; it won't access your inbox."
          : hasGoal
            ? "Let's start by listing your fixed commitments, then fit flexible tasks around them. What name should I use for you?"
            : hasName
              ? "Nice to meet you, Sam. What's been taking the most time or energy for you lately?"
              : "What name should I use for you?",
      userName: hasName ? "Sam" : "",
      helpNeed: hasGoal ? (text.includes("study plan") ? "Create a study plan for next week" : "Plan my week") : "",
      clearUserName: false, clearHelpNeed: false,
      attempted: ["userName", "helpNeed", "google"], deferred: [], topic: "work", openGoogleLink: false,
    } });
  });
});

test("after learning a name, Persona leads with a personal question", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Persona name").fill("Nova");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Type instead" }).click();
  await page.getByRole("textbox", { name: "Message to Persona" }).fill("My name is Sam");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("What's been taking the most time or energy for you lately?", { exact: false })).toBeVisible();
  await expect(page.getByText("How can I help you today?", { exact: false })).toHaveCount(0);
});

test("a spoken pause request gets a brief acknowledgment and keeps the objective", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Persona name").fill("Nova");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Type instead" }).click();
  const composer = page.getByRole("textbox", { name: "Message to Persona" });
  await composer.fill("My name is Sam");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("What's been taking the most time or energy for you lately?", { exact: false })).toBeVisible();
  await composer.fill("Wait wait wait one second");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Sure.", { exact: true })).toBeVisible();
  await expect(page.getByText("What's been taking the most time or energy for you lately?", { exact: false })).toHaveCount(0);
  await composer.fill("I'm overwhelmed with SAT prep");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("dialog", { name: "Connect Google" })).toBeVisible();
});

test("hesitation, playful answers, modal close, and repeated deferral resolve once", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByLabel("Persona name").fill("Nova");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Type instead" }).click();
  const composer = page.getByRole("textbox", { name: "Message to Persona" });
  const send = async (text: string) => { await composer.fill(text); await page.getByRole("button", { name: "Send message" }).click(); };
  await send("My name is Luca");
  await send("Um");
  await expect(page.getByText("Take your time.", { exact: true })).toBeVisible();
  await send("You");
  await expect(page.getByText(/one real thing you'd like help with/)).toBeVisible();
  await send("idk");
  await expect(page.getByText(/studying, your schedule, or staying organized/)).toBeVisible();
  await send("SAT studying has done a number on me");
  const dialog = page.getByRole("dialog", { name: "Connect Google" });
  await expect(dialog).toBeVisible();
  await expect(page.locator(".experience-error")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close Google dialog" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "What should we work on?" })).toBeVisible();
  await page.getByRole("button", { name: "Connect Google" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByText("Not now", { exact: true }).dblclick();
  await expect(page.getByRole("heading", { name: "What should we work on?" })).toBeVisible();
  await expect(page.locator(".experience-error")).toHaveCount(0);
  await page.getByRole("button", { name: "Copy debug logs" }).click();
  const logs = await page.evaluate(async () => JSON.parse(await navigator.clipboard.readText()));
  const names = logs.events.filter((event: { type: string }) => event.type === "ui_event").map((event: { detail?: { name?: string } }) => event.detail?.name);
  expect(names.filter((name: string) => name === "GRADUATION_ACK_STARTED")).toHaveLength(1);
  expect(names.filter((name: string) => name === "ONBOARDING_GRADUATED")).toHaveLength(1);
  expect(logs.profile.helpNeed).toBe("SAT prep");
  expect(logs.profile.statuses.google).toBe("deferred");
});

test("dismissing the Google sheet after waiting continues onboarding", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Persona name").fill("Nova");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Type instead" }).click();
  const composer = page.getByRole("textbox", { name: "Message to Persona" });
  await composer.fill("I'm Sam and SAT prep is taking up my time");
  await page.getByRole("button", { name: "Send message" }).click();
  const dialog = page.getByRole("dialog", { name: "Connect Google" });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(10_000);
  await dialog.getByRole("button", { name: "Close Google dialog" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "What should we work on?" })).toBeVisible();
  await expect(page.getByText("You're all set, Sam.", { exact: false })).toBeVisible();
});

test("diagnostic events persist with the onboarding run across refresh", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByLabel("Persona name").fill("Nova");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Type instead" }).click();
  await page.getByRole("textbox", { name: "Message to Persona" }).fill("My name is Luca");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("textbox", { name: "Message to Persona" })).toHaveValue("");
  await page.getByRole("button", { name: "Copy debug logs" }).click();
  const before = await page.evaluate(async () => JSON.parse(await navigator.clipboard.readText()));
  await page.reload();
  await page.getByRole("button", { name: "Copy debug logs" }).click();
  const after = await page.evaluate(async () => JSON.parse(await navigator.clipboard.readText()));
  expect(after.onboardingRunId).toBe(before.onboardingRunId);
  expect(after.events.length).toBeGreaterThan(before.events.length);
  expect(after.events.some((event: { type: string }) => event.type === "structured_capture")).toBe(true);
});

test("untrusted profile markup stays inert", async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __xss?: boolean }).__xss = false;
    window.alert = () => { (window as typeof window & { __xss?: boolean }).__xss = true; };
  });
  await page.goto("/");
  await page.getByLabel("Persona name").fill("<img src=x onerror=alert(1)>");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Review your details" }).click();
  await page.getByRole("textbox", { name: "Your name" }).fill("\"><svg onload=alert(1)>");
  await page.getByRole("textbox", { name: "What you want help with" }).fill("Plan my week <script>alert(1)</script>");
  await page.getByRole("button", { name: "Close details" }).click();
  expect(await page.evaluate(() => (window as typeof window & { __xss?: boolean }).__xss)).toBe(false);
  await expect(page.locator("svg[onload], img[onerror]")).toHaveCount(0);
});

test("copy debug logs exports the current run, transcript, and interaction events", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByLabel("Persona name").fill("Nova");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Type instead" }).click();
  await page.getByRole("textbox", { name: "Message to Persona" }).fill("I'm Sam and need help planning my week");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".voice-message-bubble--assistant")).toContainText(/(?:connect(?:\s+\w+){0,2}\s+Google|link Google)/i);
  await expect(page.getByRole("dialog", { name: "Connect Google" })).toBeVisible();
  await page.getByText("Not now", { exact: true }).click();
  await expect(page.getByText(/No problem—you can connect Google later\./)).toBeVisible();
  await expect(page.getByRole("heading", { name: "What should we work on?" })).toBeVisible();
  await expect(page.getByText("You're all set, Sam.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Copy debug logs" }).click();
  const logs = await page.evaluate(async () => JSON.parse(await navigator.clipboard.readText()));
  expect(logs.profile.turns.some((turn: { role: string; text: string }) => turn.role === "user" && turn.text.includes("I'm Sam"))).toBe(true);
  expect(logs.currentRunOnly).toBe(true);
  expect(logs.events.every((event: { sessionId: string; onboardingRunId: string }) => event.sessionId === logs.sessionId && event.onboardingRunId === logs.onboardingRunId)).toBe(true);
  expect(logs.events.some((event: { type: string; detail?: { reason?: string } }) => event.type === "fast_path_selected" && event.detail?.reason === "state_owned_google_transition")).toBe(true);
  expect(logs.profile.step).toBe("assistant");
  expect(logs.profile.statuses.google).toBe("deferred");
  expect(logs.events.some((event: { type: string; detail?: { name?: string } }) => event.type === "ui_event" && event.detail?.name === "ONBOARDING_GRADUATED")).toBe(true);
  expect(logs.events.some((event: { type: string; detail?: { name?: string } }) => event.type === "ui_event" && event.detail?.name === "MAIN_EXPERIENCE_ENTERED")).toBe(true);
  expect(logs.events.some((event: { type: string }) => event.type === "CALL_INTERRUPTED" || event.type === "RESUMING_IN_TEXT")).toBe(false);
  expect(logs.events.some((event: { type: string; detail?: { reason?: string } }) => event.type === "CALL_END_REQUESTED" && event.detail?.reason === "onboarding_complete")).toBe(true);
  const eventNames = logs.events.filter((event: { type: string }) => event.type === "ui_event").map((event: { detail?: { name?: string } }) => event.detail?.name);
  expect(eventNames.indexOf("GRADUATION_ACK_COMPLETE")).toBeLessThan(eventNames.indexOf("ONBOARDING_GRADUATED"));
  expect(logs.note).toContain("No raw audio");
});

test("Google sheet waits until the assistant transcript offers a connection", async ({ page }) => {
  await page.route("**/api/conversation", async (route) => route.fulfill({ json: {
    reply: "Google has lots of useful tools. What's been taking the most time lately?",
    userName: "Sam", helpNeed: "", clearUserName: false, clearHelpNeed: false,
    attempted: [], deferred: [], topic: "work", openGoogleLink: true,
  } }));
  await page.goto("/");
  await page.getByLabel("Persona name").fill("Nova");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Type instead" }).click();
  await page.getByRole("textbox", { name: "Message to Persona" }).fill("I'm Sam");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("What's been taking the most time lately?", { exact: false })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Connect Google" })).toHaveCount(0);
});

test("a useful goal unlocks early graduation before collecting the user's name", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByLabel("Persona name").fill("Nova");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Type instead" }).click();
  await page.getByRole("textbox", { name: "Message to Persona" }).fill("I need a study plan for next week");
  await page.getByRole("button", { name: "Send message" }).click();
  const googleDialog = page.getByRole("dialog", { name: "Connect Google" });
  await expect(page.locator(".voice-message-bubble--assistant")).toContainText(/connect Google/i);
  await expect(googleDialog).toBeVisible();
  await googleDialog.getByText("Not now", { exact: true }).click();
  await expect(page.getByText("What's a name you'd like me to use?", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enter Persona" })).toBeVisible();
  await page.getByRole("button", { name: "Enter Persona" }).click();
  await expect(page.getByRole("heading", { name: "What should we work on?" })).toBeVisible();
  await expect(page.getByText("Create a study plan for next week")).toBeVisible();
  await page.getByRole("button", { name: "Copy debug logs" }).click();
  const logs = await page.evaluate(async () => JSON.parse(await navigator.clipboard.readText()));
  expect(logs.events.some((event: { type: string }) => event.type === "EARLY_GRADUATION_REQUESTED")).toBe(true);
  expect(logs.events.some((event: { type: string; detail?: { transition?: string } }) => event.type === "graduation_decision" && event.detail?.transition === "explicit_early_request")).toBe(true);
});

test("captures facts, restores progress, and enters a useful assistant", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Persona name").fill("Nova");
  await page.getByRole("button", { name: "Continue" }).click();
  const particles = page.locator("canvas[data-particle-transition]");
  await particles.waitFor({ state: "attached" });
  await page.waitForTimeout(450);
  const visiblePixels = await particles.evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    if (!context) return 0;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 64) {
      if (pixels[index] < 210 || pixels[index + 1] < 210 || pixels[index + 2] < 210) count += 1;
    }
    return count;
  });
  expect(visiblePixels).toBeGreaterThan(20);
  await particles.waitFor({ state: "detached", timeout: 8000 });
  await expect(page.getByRole("button", { name: /Start a call|Resume call/ })).toBeVisible();
  await page.getByRole("button", { name: "Type instead" }).click();
  await page.getByRole("textbox", { name: "Message to Persona" }).fill("I'm Sam and need help planning my week");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("dialog", { name: "Connect Google" })).toBeVisible();
  await page.getByText("Not now", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "What should we work on?" })).toBeVisible();
  await expect(page.getByText("Google · Not connected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Google" })).toBeVisible();
  await page.screenshot({ path: "test-results/persona-desktop.png", fullPage: true });
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Connect Google" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "What should we work on?" })).toBeVisible();
  await page.getByRole("button", { name: "Review your details" }).click();
  await expect(page.getByRole("textbox", { name: "Your name" })).toHaveValue("Sam");
  await expect(page.getByRole("textbox", { name: "What you want help with" })).toHaveValue("Plan my week");
  await page.getByRole("button", { name: "Close details" }).click();
  await expect(page.getByRole("dialog", { name: "Connect Google" })).toHaveCount(0);
  await page.getByRole("button", { name: "Connect Google" }).click();
  await expect(page.getByRole("dialog", { name: "Connect Google" })).toBeVisible();
  await page.getByRole("dialog", { name: "Connect Google" }).getByText("Not now", { exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Connect Google" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Message to Persona" }).fill("How do I start?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("First, list your three priorities.", { exact: false })).toBeVisible();
});

test("successful Google linking graduates and preserves the linked identity", async ({ page }) => {
  await page.addInitScript(() => {
    const windowWithGoogle = window as typeof window & { google?: unknown; gsiCallback?: (response: { credential: string }) => void };
    windowWithGoogle.google = { accounts: { id: {
      initialize: (options: { callback: (response: { credential: string }) => void }) => { windowWithGoogle.gsiCallback = options.callback; },
      renderButton: (target: HTMLElement) => {
        const button = document.createElement("button");
        button.textContent = "Continue with Google";
        button.onclick = () => windowWithGoogle.gsiCallback?.({ credential: "test-credential" });
        target.append(button);
      },
    } } };
  });
  await page.route("**/api/config", async (route) => route.fulfill({ json: { googleClientId: "test-client-id" } }));
  await page.route("**/api/google", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { account: null } });
    return route.fulfill({ json: { account: { email: "luca@gmail.com", sub: "google-luca" } } });
  });
  await page.goto("/");
  await page.getByLabel("Persona name").fill("Nova");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Type instead" }).click();
  await page.getByRole("textbox", { name: "Message to Persona" }).fill("I'm Sam and need help planning my week");
  await page.getByRole("button", { name: "Send message" }).click();
  const dialog = page.getByRole("dialog", { name: "Connect Google" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByText("You're all set, Sam.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What should we work on?" })).toBeVisible();
  await expect(page.getByText("Google · luca@gmail.com")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Google" })).toHaveCount(0);
});

test("a restored resolved profile stays in onboarding until the user explicitly enters", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("persona-onboarding-v1", JSON.stringify({
      version: 1, step: "conversation", agentName: "Nova", userName: "Luca", helpNeed: "SAT prep",
      statuses: { userName: "confirmed", helpNeed: "confirmed", google: "deferred" },
      turns: [{ id: "voice-1", role: "assistant", text: "What has been taking your energy?", source: "voice", at: 1 }],
      topic: "work", callState: "ended", muted: false,
    }));
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Nova" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enter Persona" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What should we work on?" })).toHaveCount(0);
  await page.getByRole("button", { name: "Review your details" }).click();
  await expect(page.getByRole("textbox", { name: "Your name" })).toHaveValue("Luca");
  await expect(page.getByRole("textbox", { name: "What you want help with" })).toHaveValue("SAT prep");
  await page.getByRole("button", { name: "Close details" }).click();
  await page.getByRole("button", { name: "Enter Persona" }).click();
  await expect(page.getByRole("heading", { name: "What should we work on?" })).toBeVisible();
});

test("setup's entrance does not create a temporary page scrollbar", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => {
    const sample = () => {
      if (document.documentElement.scrollHeight > window.innerHeight + 1) {
        sessionStorage.setItem("persona-overflow-seen", "true");
      }
    };
    new MutationObserver(sample).observe(document, { attributes: true, childList: true, subtree: true });
    window.setInterval(sample, 16);
  });
  await page.goto("/");
  await page.waitForTimeout(850);
  expect(await page.evaluate(() => sessionStorage.getItem("persona-overflow-seen"))).toBeNull();
});

test("name suggestions erase and type the next option", async ({ page }) => {
  await page.goto("/");
  const name = page.getByLabel("Persona name");
  await expect(name).toHaveAttribute("placeholder", "Nova");
  await expect(name).toHaveAttribute("placeholder", "Atlas", { timeout: 7000 });
  await page.getByRole("button", { name: "Continue" }).click();
  const particles = page.locator("canvas[data-particle-transition]");
  await particles.waitFor({ state: "attached" });
  await particles.waitFor({ state: "detached", timeout: 8000 });
  await expect(page.getByRole("heading", { name: "Atlas" })).toBeVisible();
});

test("Google button loading does not shift the details dialog", async ({ page }) => {
  await page.route("**/api/config", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.fulfill({ json: { googleClientId: "demo-client" } });
  });
  await page.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({
    contentType: "application/javascript",
    body: "window.google={accounts:{id:{initialize(){},renderButton(el){setTimeout(()=>{el.innerHTML='<button style=\"width:232px;height:40px\">Google</button>'},100)}}}};",
  }));
  await page.goto("/");
  await page.getByLabel("Persona name").fill("Nova");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Review your details" }).click();
  const dialog = page.getByRole("dialog", { name: "Your details" });
  const before = await dialog.boundingBox();
  await page.waitForTimeout(1200);
  const after = await dialog.boundingBox();
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(1);
});

test("microphone denial keeps text available", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => { throw new Error("Microphone permission denied"); } });
  });
  await page.goto("/");
  await page.getByLabel("Persona name").fill("Nova");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".experience-error")).toContainText(/Microphone (?:permission denied|access is unavailable)/);
  await page.getByRole("button", { name: "Type instead" }).click();
  await expect(page.getByRole("textbox", { name: "Message to Persona" })).toBeVisible();
});

test("a clear help need advances straight to Google without a model request", async ({ page }) => {
  let modelCalls = 0;
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => new MediaStream() });
    class MockRecognition {
      lang = "en-US";
      continuous = false;
      interimResults = true;
      onresult: ((event: unknown) => void) | null = null;
      onstart: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start() { this.onstart?.(); }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    Object.defineProperty(window, "SpeechRecognition", { value: MockRecognition, configurable: true });
  });
  await page.route("**/api/live-token", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.fulfill({ status: 503, json: { error: "Voice is not used in this text-path test." } });
  });
  await page.route("**/api/conversation", (route) => {
    modelCalls += 1;
    return route.fulfill({ status: 503, json: { error: "The assistant is temporarily unavailable." } });
  });
  await page.goto("/");
  await page.getByLabel("Persona name").fill("Nova");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Type instead" }).click();
  const composer = page.getByRole("textbox", { name: "Message to Persona" });
  await composer.fill("I need help with my schedule");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".experience-error")).toHaveCount(0);
  await expect(composer).toHaveValue("");
  await expect(page.getByRole("dialog", { name: "Connect Google" })).toBeVisible();
  expect(modelCalls).toBe(0);
  await expect(page.getByRole("button", { name: "Enter Persona" })).toBeVisible();
});

test("hangup during connection ignores a late token", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => new MediaStream() });
    class MockSpeechRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start() {}
      stop() {}
      abort() {}
    }
    Object.assign(window, { SpeechRecognition: MockSpeechRecognition });
  });
  await page.route("**/api/live-token", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 10000));
    await route.fulfill({ json: { token: "too-late" } });
  });
  await page.goto("/");
  await page.getByLabel("Persona name").fill("Nova");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("button", { name: "End call" })).toBeVisible();
  await page.getByRole("button", { name: "End call" }).click();
  await expect(page.getByText("Call ended")).toBeVisible();
  await page.waitForTimeout(1800);
  await expect(page.getByText("Call ended")).toBeVisible();
  await expect(page.locator(".experience-error")).toHaveCount(0);
});

test("the call starts on continue and a hangup during microphone permission stays ended", async ({ page }) => {
  await page.addInitScript(() => {
    let resolvePermission: ((stream: MediaStream) => void) | undefined;
    let permissionRequests = 0;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: () => {
        permissionRequests += 1;
        return new Promise<MediaStream>((resolve) => { resolvePermission = resolve; });
      },
    });
    Object.assign(window, {
      SpeechRecognition: class {
        start() {}
        stop() {}
        abort() {}
      },
      finishPermission: () => resolvePermission?.(new MediaStream()),
      permissionCount: () => permissionRequests,
    });
  });
  let tokenRequests = 0;
  await page.route("**/api/live-token", (route) => { tokenRequests += 1; return route.fulfill({ json: { token: "unexpected" } }); });
  await page.goto("/");
  await page.getByLabel("Persona name").fill("Nova");
  await page.getByRole("button", { name: "Continue" }).evaluate((button: HTMLElement) => {
    button.click();
    button.click();
    button.click();
  });
  await expect(page.getByRole("button", { name: "End call" })).toBeVisible();
  await page.getByRole("button", { name: "End call" }).click();
  await page.evaluate(() => (window as typeof window & { finishPermission: () => void }).finishPermission());
  await expect(page.getByText("Call ended")).toBeVisible();
  expect(tokenRequests).toBe(0);
  expect(await page.evaluate(() => (window as typeof window & { permissionCount: () => number }).permissionCount())).toBe(1);
});

test("rapid call starts request microphone permission only once", async ({ page }) => {
  await page.addInitScript(() => {
    let requests = 0;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: () => { requests += 1; return new Promise<MediaStream>(() => undefined); },
    });
    Object.assign(window, {
      SpeechRecognition: class { start() {} stop() {} abort() {} },
      permissionCount: () => requests,
    });
  });
  await page.goto("/");
  await page.getByLabel("Persona name").fill("Nova");
  await page.getByRole("button", { name: "Continue" }).evaluate((button: HTMLElement) => {
    button.click();
    button.click();
    button.click();
  });
  await expect(page.getByRole("button", { name: "End call" })).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { permissionCount: () => number }).permissionCount())).toBe(1);
});

test("a late text response cannot undo a reset", async ({ page }) => {
  let finishReply: (() => void) | undefined;
  const replyPending = new Promise<void>((resolve) => { finishReply = resolve; });
  await page.route("**/api/conversation", async (route) => {
    await replyPending;
    try {
      await route.fulfill({ json: {
        reply: "Nice to meet you, Sam.", userName: "Sam", helpNeed: "Plan my week",
        clearUserName: false, clearHelpNeed: false, attempted: [], deferred: [], topic: "work", openGoogleLink: false,
      } });
    } catch { /* Reset aborts the request. */ }
  });
  await page.goto("/");
  await page.getByLabel("Persona name").fill("Nova");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Type instead" }).click();
  await page.getByRole("textbox", { name: "Message to Persona" }).fill("The weather has been odd this week");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
  await page.getByRole("button", { name: "Review your details" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset this demo" }).click();
  finishReply?.();
  await expect(page.getByLabel("Persona name")).toBeVisible();
  await expect(page.getByText("Nice to meet you, Sam.")).toHaveCount(0);
});

test("an interrupted call cannot trap someone who already shared a goal", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => new MediaStream() });
    Object.assign(window, { SpeechRecognition: class { start() {} stop() {} abort() {} } });
  });
  await page.route("**/api/live-token", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 8000));
    try { await route.fulfill({ json: { token: "too-late" } }); } catch { /* Hangup aborts the request. */ }
  });
  await page.goto("/");
  await page.getByLabel("Persona name").fill("Nova");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Type instead" }).click();
  await page.getByRole("textbox", { name: "Message to Persona" }).fill("I'm Sam and need help planning my week");
  await page.getByRole("button", { name: "Send message" }).click();
  const googleDialog = page.getByRole("dialog", { name: "Connect Google" });
  await expect(googleDialog).toBeVisible();
  await googleDialog.getByText("Not now", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "What should we work on?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Start a call|Resume call/ })).toHaveCount(0);
});

test("mobile layout has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await page.getByLabel("Persona name").fill("Nova");
  await page.getByRole("button", { name: "Continue" }).click();
  const particles = page.locator("canvas[data-particle-transition]");
  await particles.waitFor({ state: "attached" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/particle-mobile.png" });
  await page.waitForTimeout(480);
  await page.screenshot({ path: "test-results/particle-mobile-reform.png" });
  await particles.waitFor({ state: "detached", timeout: 8000 });
  await page.getByRole("button", { name: "Type instead" }).click();
  await page.screenshot({ path: "test-results/persona-mobile-small.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 375, height: 740 });
  await page.screenshot({ path: "test-results/persona-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
