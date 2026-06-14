import type { VercelRequest, VercelResponse } from "@vercel/node";
import { webhookCallback } from "grammy";
import { login, refreshRestaurants } from "../src/api";
import { createBot } from "../src/bot";

const TOKEN = process.env.TOKEN ?? "";
const EMAIL = process.env.EVRASIA_EMAIL ?? "";
const PASSWORD = process.env.EVRASIA_PASSWORD ?? "";

type ExpressHandler = (req: VercelRequest, res: VercelResponse) => Promise<void>;
let handleUpdate: ExpressHandler | null = null;
let initPromise: Promise<void> | null = null;

async function initialize() {
  if (!TOKEN) throw new Error("TOKEN is not set");
  if (!EMAIL || !PASSWORD) throw new Error("EVRASIA_EMAIL or EVRASIA_PASSWORD is not set");

  console.log("Initializing: logging in...");
  await login(EMAIL, PASSWORD);

  console.log("Initializing: fetching restaurants...");
  await refreshRestaurants();

  const bot = createBot(TOKEN, EMAIL, PASSWORD);
  handleUpdate = webhookCallback(bot, "express") as unknown as ExpressHandler;
  console.log("Initialization complete");
}

function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = initialize().catch((err) => {
      console.error("Initialization failed:", err);
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await ensureInit();
    await handleUpdate!(req, res);
  } catch (err) {
    console.error("Handler error:", err);
    res.status(200).send("ok");
  }
}
