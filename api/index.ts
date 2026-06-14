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

async function initialize(): Promise<void> {
  await login(EMAIL, PASSWORD);
  await refreshRestaurants();
  const bot = createBot(TOKEN, EMAIL, PASSWORD);
  handleUpdate = webhookCallback(bot, "next-js") as unknown as ExpressHandler;
}

function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = initialize().catch((err) => {
      console.error("Init failed:", err);
      initPromise = null;
      handleUpdate = null;
      throw err;
    });
  }
  return initPromise;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST" || !req.body?.update_id) {
    res.status(200).send("ok");
    return;
  }

  try {
    await ensureInit();
    await handleUpdate!(req, res);
  } catch (err) {
    console.error("Handler error:", err);
    res.status(200).send("ok");
  }
}
