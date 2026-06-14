import "dotenv/config";
import { webhookCallback } from "grammy";
import { login, refreshRestaurants } from "../src/api";
import { createBot } from "../src/bot";

const TOKEN = process.env.TOKEN ?? "";
const EMAIL = process.env.EVRASIA_EMAIL ?? "";
const PASSWORD = process.env.EVRASIA_PASSWORD ?? "";

let initPromise: Promise<void> | null = null;
type StdHandler = (req: Request) => Promise<Response>;
let handleUpdate: StdHandler | null = null;

async function initialize() {
  await login(EMAIL, PASSWORD);
  await refreshRestaurants();
  const bot = createBot(TOKEN, EMAIL, PASSWORD);
  handleUpdate = webhookCallback(bot, "std/http") as unknown as StdHandler;
}

function ensureInit(): Promise<void> {
  if (!initPromise) initPromise = initialize();
  return initPromise;
}

export default async function handler(req: Request): Promise<Response> {
  await ensureInit();
  return handleUpdate!(req);
}
