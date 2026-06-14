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

  console.log("Logging in to evrasia.rest...");
  await login(EMAIL, PASSWORD);

  console.log("Fetching restaurant list...");
  await refreshRestaurants();

  setInterval(refreshRestaurants, REFRESH_INTERVAL_MS);

  const bot = createBot(TOKEN, EMAIL, PASSWORD);
  await bot.start();
  console.log("Bot started (long polling)");
}

main();
