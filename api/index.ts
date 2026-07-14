import type { VercelRequest, VercelResponse } from "@vercel/node";
import { webhookCallback } from "grammy";
import { initAccounts, loginCurrentAccount, refreshRestaurants } from "../src/api";
import { createBot } from "../src/bot";

const TOKEN = process.env.TOKEN ?? "";
const ACCOUNTS_RAW = process.env.EVRASIA_ACCOUNTS ?? "";
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID ? Number(process.env.ADMIN_CHAT_ID) : undefined;

type ExpressHandler = (req: VercelRequest, res: VercelResponse) => Promise<void>;

let handleUpdate: ExpressHandler | null = null;
let initPromise: Promise<void> | null = null;

async function initialize(): Promise<void> {
  initAccounts(ACCOUNTS_RAW);
  await loginCurrentAccount();
  await refreshRestaurants();
  const bot = createBot(TOKEN, ADMIN_CHAT_ID);
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
