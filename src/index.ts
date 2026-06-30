import "dotenv/config";
import { login, refreshRestaurants } from "./api";
import { createBot } from "./bot";

const TOKEN = process.env.TOKEN ?? "";
const EMAIL = process.env.EVRASIA_EMAIL ?? "";
const PASSWORD = process.env.EVRASIA_PASSWORD ?? "";
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function main() {
  if (!TOKEN) throw new Error("TOKEN env variable is required");
  if (!EMAIL || !PASSWORD) throw new Error("EVRASIA_EMAIL and EVRASIA_PASSWORD env variables are required");

  // Upstream may be down at boot — don't let that prevent the bot from starting.
  // requestCode() will transparently re-login on its own if the session is missing.
  try {
    console.log("Logging in to evrasia.rest...");
    await login(EMAIL, PASSWORD);

    console.log("Fetching restaurant list...");
    await refreshRestaurants();
  } catch (err) {
    console.error("Initial login/restaurant fetch failed, starting bot anyway:", err);
  }

  setInterval(() => {
    refreshRestaurants().catch((err) => console.error("Restaurant refresh failed:", err));
  }, REFRESH_INTERVAL_MS);

  const bot = createBot(TOKEN, EMAIL, PASSWORD);

  // Remove webhook if set — required before long polling can start
  await bot.api.deleteWebhook();

  await bot.start();
  console.log("Bot started (long polling)");
}

main().catch((err) => {
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
