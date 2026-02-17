import fs from "fs";
import path from "path";
import process from "process";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { chromium } from "playwright";

const argv = new Set(process.argv.slice(2));
const headed = argv.has("--headed");

dotenv.config();

const CONFIG = {
  startUrl: process.env.START_URL || "https://melodymagicmusic.opus1.io",
  scheduleUrl: process.env.SCHEDULE_URL || "",
  username: process.env.MELODY_USERNAME || "",
  password: process.env.MELODY_PASSWORD || "",
  className: process.env.CLASS_NAME || "Level 1 Tuesdays 10:00",
  classDay: process.env.CLASS_DAY || "Tuesday",
  instructor: process.env.INSTRUCTOR || "",
  location: process.env.LOCATION || "",
  stateFile: process.env.STATE_FILE || "./state.json",
  alertMode: process.env.ALERT_MODE || "always",
  dryRun: (process.env.DRY_RUN || "false").toLowerCase() === "true",
  pushover: {
    token: process.env.PUSHOVER_APP_TOKEN || "",
    user: process.env.PUSHOVER_USER_KEY || "",
    device: process.env.PUSHOVER_DEVICE || ""
  },
  debug: (process.env.DEBUG || "false").toLowerCase() === "true"
};

if (!CONFIG.username || !CONFIG.password) {
  console.error("Missing MELODY_USERNAME or MELODY_PASSWORD in env.");
  process.exit(2);
}
if (!CONFIG.pushover.token || !CONFIG.pushover.user) {
  console.error("Missing PUSHOVER_APP_TOKEN or PUSHOVER_USER_KEY in env.");
  process.exit(2);
}

const STATE_PATH = path.resolve(CONFIG.stateFile);

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { lastStatus: "unknown" };
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function normalizeStatus(text) {
  const value = (text || "").trim().toLowerCase();
  if (!value) return "unknown";
  if (value.includes("full")) return "full";
  if (value.includes("wait")) return "waitlist";
  if (value.includes("open") || value.includes("available")) return "available";
  return value;
}

async function sendPushover(message, title = "Class Availability") {
  if (CONFIG.dryRun) {
    console.log(`[DRY_RUN] Would send Pushover: ${title} - ${message}`);
    return;
  }
  const payload = new URLSearchParams();
  payload.set("token", CONFIG.pushover.token);
  payload.set("user", CONFIG.pushover.user);
  payload.set("message", message);
  payload.set("title", title);
  if (CONFIG.pushover.device) payload.set("device", CONFIG.pushover.device);

  const response = await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    body: payload
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Pushover error: ${response.status} ${text}`);
  }
}

async function waitForLocatorInPageOrFrames(page, selector, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const direct = page.locator(selector);
      if (await direct.count()) return direct;
    } catch (error) {
      lastError = error;
    }

    for (const frame of page.frames()) {
      try {
        const loc = frame.locator(selector);
        if (await loc.count()) return loc;
      } catch (error) {
        lastError = error;
      }
    }

    await page.waitForTimeout(250);
  }

  if (lastError) throw lastError;
  throw new Error(`Timeout waiting for selector in page or frames: ${selector}`);
}

async function detectStatus(page) {
  const context = page.context();
  const creditButton = page.locator("#credit-item-use-0");

  try {
    await creditButton.first().waitFor({ state: "visible", timeout: 15000 });
    await creditButton.first().scrollIntoViewIfNeeded();
    const popupPromise = page.context().waitForEvent("page", { timeout: 10000 }).catch(() => null);
    await Promise.all([
      page.waitForLoadState("domcontentloaded").catch(() => {}),
      creditButton.first().click()
    ]);
    const popup = await popupPromise;
    if (popup) {
      await popup.waitForLoadState("domcontentloaded");
      page = popup;
    }
  } catch {
    // Button never appeared; continue without using credit
  }

  await page.waitForTimeout(500);

  // The session list sometimes isn't inside #session-slot-step; wait for the class list area
  if (CONFIG.debug) {
    const frameUrls = page.frames().map((frame) => frame.url());
    console.log("Frame URLs:", frameUrls);
  }

  const sessionHint = await waitForLocatorInPageOrFrames(
    page,
    "text=Select tags to filter sessions",
    20000
  );
  await sessionHint.first().scrollIntoViewIfNeeded();

  if (CONFIG.classDay) {
    const dayButton = page.getByRole("button", { name: new RegExp(`^${CONFIG.classDay}$`, "i") });
    if (await dayButton.count()) {
      await dayButton.first().click();
    }
  }

  const classTitle = await waitForLocatorInPageOrFrames(page, `text=${CONFIG.className}`, 20000);
  await classTitle.first().scrollIntoViewIfNeeded();

  // Walk up to the nearest card/container and check for a "Full" tag or label inside it
  const classItem = classTitle.locator(
    "xpath=ancestor::*[self::li or self::div][1]"
  );
  const isFull =
    (await classItem.locator(".session-tag-full").count()) > 0 ||
    (await classItem.getByText(/full/i).count()) > 0;

  const metaPieces = [];
  if (CONFIG.instructor) metaPieces.push(CONFIG.instructor);
  if (CONFIG.location) metaPieces.push(CONFIG.location);
  const meta = metaPieces.length ? ` (${metaPieces.join(" • ")})` : "";

  return {
    status: isFull ? "full" : "available",
    rawStatus: isFull ? "Full" : "Available",
    summary: `${CONFIG.className}${meta}`
  };
}

async function main() {
  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage();

  try {
    await page.goto(CONFIG.startUrl, { waitUntil: "domcontentloaded" });

    const signInLink = page.getByRole("link", { name: /sign in|login/i });
    if (await signInLink.count()) {
      await signInLink.first().click();
    }

    const emailInput = page.locator("input[type='email'], input[name*='email' i], input[placeholder*='email' i]").first();
    const passwordInput = page.locator("input[type='password']").first();

    await emailInput.waitFor({ timeout: 15000 });
    await emailInput.fill(CONFIG.username);
    await passwordInput.fill(CONFIG.password);

    const submitButton = page.getByRole("button", { name: /sign in|log in|login/i });
    if (await submitButton.count()) {
      await submitButton.first().click();
    } else {
      await passwordInput.press("Enter");
    }

    if (CONFIG.scheduleUrl) {
      await page.goto(CONFIG.scheduleUrl, { waitUntil: "domcontentloaded" });
    }

    const result = await detectStatus(page);
    console.log(`Status: ${result.status} (${result.rawStatus}) for ${result.summary}`);

    const state = readState();
    const shouldAlert = (() => {
      if (CONFIG.alertMode === "never") return false;
      if (CONFIG.alertMode === "always") return true;
      if (CONFIG.alertMode === "test") return true;
      if (CONFIG.alertMode === "available") return result.status === "available";
      if (CONFIG.alertMode === "on-change") return result.status !== state.lastStatus;
      return result.status === "available";
    })();

    if (shouldAlert) {
      const message = `${result.summary} is ${result.rawStatus || result.status}.`;
      await sendPushover(message, "Class Availability");
      console.log("Notification sent.");
    } else {
      console.log("No notification sent.");
    }

    writeState({ lastStatus: result.status, lastCheckedAt: new Date().toISOString() });
  } catch (error) {
    if (CONFIG.debug) {
      const screenshotPath = path.resolve("./debug.png");
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`Saved screenshot to ${screenshotPath}`);
      } catch (screenshotError) {
        console.warn("Failed to capture screenshot:", screenshotError);
      }
    }
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
