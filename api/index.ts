import { webhookCallback } from "grammy";
import { login, refreshRestaurants } from "../src/api";
import { createBot } from "../src/bot";

const TOKEN = process.env.TOKEN ?? "";
const EMAIL = process.env.EVRASIA_EMAIL ?? "";
const PASSWORD = process.env.EVRASIA_PASSWORD ?? "";

type StdHandler = (req: Request) => Promise<Response>;
let handleUpdate: StdHandler | null = null;
let initPromise: Promise<void> | null = null;

async function initialize() {
  if (!TOKEN) throw new Error("TOKEN is not set");
  if (!EMAIL || !PASSWORD) throw new Error("EVRASIA_EMAIL or EVRASIA_PASSWORD is not set");

  console.log("Initializing: logging in...");
  await login(EMAIL, PASSWORD);

  console.log("Initializing: fetching restaurants...");
  await refreshRestaurants();

  const bot = createBot(TOKEN, EMAIL, PASSWORD);
  handleUpdate = webhookCallback(bot, "std/http") as unknown as StdHandler;
  console.log("Initialization complete");
}

function ensureInit(): Promise<void> {
  // Reset on failure so next request retries
  if (!initPromise) {
    initPromise = initialize().catch((err) => {
      console.error("Initialization failed:", err);
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export default async function handler(req: Request): Promise<Response> {
  try {
    await ensureInit();
    return await handleUpdate!(req);
  } catch (err) {
    console.error("Handler error:", err);
    // Return 200 to prevent Telegram from retrying indefinitely
    return new Response("ok", { status: 200 });
  }
}
