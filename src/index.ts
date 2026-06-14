import "dotenv/config";
import { Bot, Context, InlineKeyboard, session, SessionFlavor } from "grammy";
import { login, requestCode, fetchRestaurants, Restaurant } from "./api";

const TOKEN = process.env.TOKEN ?? "";
const EMAIL = process.env.EVRASIA_EMAIL ?? "";
const PASSWORD = process.env.EVRASIA_PASSWORD ?? "";

const PER_PAGE = 8;
const COOLDOWN_MS = 30_000;
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // раз в сутки

let rests: Restaurant[] = [];

interface SessionData {
  search?: string;
  page: number;
  lastCodeTime?: number;
  lastRestId?: number;
}

type BotCtx = Context & SessionFlavor<SessionData>;

function filtered(search?: string): Restaurant[] {
  if (!search) return rests;
  const q = search.toLowerCase();
  return rests.filter((r) => r.name.toLowerCase().includes(q));
}

function buildMenuKeyboard(page: number, search?: string): InlineKeyboard {
  const list = filtered(search);
  const totalPages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const slice = list.slice(safePage * PER_PAGE, (safePage + 1) * PER_PAGE);

  const kb = new InlineKeyboard();
  for (const rest of slice) {
    kb.text(rest.name, `rest:${rest.id}`).row();
  }

  if (safePage > 0) {
    kb.text("◀️", `page:${safePage - 1}`);
  } else {
    kb.text("·", "noop");
  }
  kb.text(`${safePage + 1} / ${totalPages}`, "noop");
  if (safePage < totalPages - 1) {
    kb.text("▶️", `page:${safePage + 1}`);
  } else {
    kb.text("·", "noop");
  }
  kb.row();

  if (search) {
    kb.text(`✕ Сбросить поиск`, "clear_search").row();
  }

  return kb;
}

function menuText(search?: string): string {
  const list = filtered(search);
  if (search && list.length === 0) {
    return `Ничего не найдено по запросу «${search}».\n\nПопробуйте другое слово.`;
  }
  if (search) {
    return `Результаты по «<b>${search}</b>» — ${list.length} рест.`;
  }
  return `Выберите ресторан из списка\n<b>или напишите адрес для поиска</b>`;
}

async function showMenu(ctx: BotCtx, edit = false) {
  const { page, search } = ctx.session;
  const kb = buildMenuKeyboard(page, search);
  const text = menuText(search);

  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
  } else {
    await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
  }
}

async function refreshRestaurants() {
  try {
    const updated = await fetchRestaurants();
    rests = updated;
    console.log(`Restaurant list updated: ${rests.length} restaurants`);
  } catch (err) {
    console.error("Failed to refresh restaurant list:", err);
  }
}

async function main() {
  if (!TOKEN) throw new Error("TOKEN env variable is required");
  if (!EMAIL || !PASSWORD) throw new Error("EVRASIA_EMAIL and EVRASIA_PASSWORD env variables are required");

  console.log("Logging in to evrasia.rest...");
  await login(EMAIL, PASSWORD);

  console.log("Fetching restaurant list...");
  await refreshRestaurants();

  // Refresh list daily
  setInterval(refreshRestaurants, REFRESH_INTERVAL_MS);

  const bot = new Bot<BotCtx>(TOKEN);

  bot.use(
    session<SessionData, BotCtx>({
      initial: () => ({ page: 0 }),
    })
  );

  bot.command("start", async (ctx) => {
    const kb = new InlineKeyboard()
      .text("🍱 Выбрать ресторан", "open_menu")
      .row()
      .text("ℹ️ Инструкция", "show_help");

    await ctx.reply(
      `Добро пожаловать! 👋\n\nЭтот бот помогает получить код для <b>скидки по красной карте Евразия</b> 🇯🇵\n\nВыберите ресторан — получите 4-значный код для официанта.`,
      { parse_mode: "HTML", reply_markup: kb }
    );
  });

  bot.command("menu", async (ctx) => {
    ctx.session.page = 0;
    ctx.session.search = undefined;
    await showMenu(ctx);
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(helpText(), { parse_mode: "HTML" });
  });

  bot.callbackQuery("open_menu", async (ctx) => {
    ctx.session.page = 0;
    ctx.session.search = undefined;
    await ctx.answerCallbackQuery();
    await showMenu(ctx);
  });

  bot.callbackQuery("show_help", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(helpText(), { parse_mode: "HTML" });
  });

  bot.callbackQuery(/^page:(\d+)$/, async (ctx) => {
    ctx.session.page = parseInt(ctx.match[1], 10);
    await ctx.answerCallbackQuery();
    await showMenu(ctx, true);
  });

  bot.callbackQuery("noop", (ctx) => ctx.answerCallbackQuery());

  bot.callbackQuery("clear_search", async (ctx) => {
    ctx.session.search = undefined;
    ctx.session.page = 0;
    await ctx.answerCallbackQuery();
    await showMenu(ctx, true);
  });

  bot.callbackQuery(/^rest:(\d+)$/, async (ctx) => {
    const restId = parseInt(ctx.match[1], 10);
    const rest = rests.find((r) => r.id === restId);
    if (!rest) {
      await ctx.answerCallbackQuery("Ресторан не найден");
      return;
    }

    const elapsed = Date.now() - (ctx.session.lastCodeTime ?? 0);
    if (restId === ctx.session.lastRestId && elapsed < COOLDOWN_MS) {
      const wait = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
      await ctx.answerCallbackQuery(`⏳ Подождите ещё ${wait} сек.`);
      return;
    }

    await ctx.answerCallbackQuery("⏳ Запрашиваю код...");

    try {
      const code = await requestCode(restId, EMAIL, PASSWORD);

      if (code) {
        ctx.session.lastCodeTime = Date.now();
        ctx.session.lastRestId = restId;

        await ctx.editMessageText(
          `✅ <b>${rest.name}</b>\n\nКод для официанта: <code>${code}</code>\n\n<i>Скажите официанту «Красная карта» и назовите этот код</i>`,
          {
            parse_mode: "HTML",
            reply_markup: new InlineKeyboard()
              .text("🔄 Новый код", `rest:${restId}`)
              .text("📋 Другой ресторан", "open_menu"),
          }
        );
      } else {
        await ctx.editMessageText(
          `⚠️ Не удалось получить код для\n<b>${rest.name}</b>\n\nПопробуйте ещё раз или выберите другой ресторан.`,
          {
            parse_mode: "HTML",
            reply_markup: new InlineKeyboard()
              .text("🔄 Повторить", `rest:${restId}`)
              .text("📋 Список", "open_menu"),
          }
        );
      }
    } catch (err) {
      console.error("requestCode error:", err);
      await ctx.reply("❌ Произошла ошибка. Попробуйте позже.");
    }
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return;

    ctx.session.search = text;
    ctx.session.page = 0;
    await showMenu(ctx);
  });

  bot.catch((err) => console.error("Bot error:", err));

  await bot.start();
  console.log("Bot started (long polling)");
}

function helpText(): string {
  return `<b>Как получить скидку по красной карте:</b>

1️⃣ Нажмите /menu или кнопку «Выбрать ресторан»
2️⃣ Найдите свой ресторан в списке (или введите часть адреса)
3️⃣ Нажмите на ресторан — получите 4-значный код
4️⃣ Скажите официанту: «У меня <b>красная карта</b>»
5️⃣ Назовите код из бота

💲 <b>Красная карта</b> — скидка 30% на всё меню включая алкоголь 🍾
1️⃣➕1️⃣ Акция 1+1 в счастливые часы`;
}

main();
