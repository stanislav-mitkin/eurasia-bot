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
  handleUpdate = webhookCallback(bot, "next-js") as unknown as ExpressHandler;
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
  console.log("method:", req.method, "body type:", typeof req.body, "preview:", JSON.stringify(req.body)?.slice(0, 80));

  if (req.method !== "POST") {
    res.status(200).send("ok");
    return;
  }

  // Parse body if it came in as a string
  if (typeof req.body === "string") {
    try { req.body = JSON.parse(req.body); } catch { /* ignore */ }
  }

  if (!req.body?.update_id) {
    console.log("Not a Telegram update, skipping");
    res.status(200).send("ok");
    return;
  }

  try {
    await ensureInit();
    console.log("Calling handleUpdate...");
    await handleUpdate!(req, res);
    console.log("handleUpdate done");
  } catch (err) {
    console.error("Handler error:", String(err));
    res.status(200).send("ok");
  }
}
