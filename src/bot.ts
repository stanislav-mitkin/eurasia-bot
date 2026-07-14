import { Bot, Context, InlineKeyboard, session, SessionFlavor } from "grammy";
import { requestCode, getRests, listAccounts, setCurrentAccount, Restaurant, UpstreamError } from "./api";
import { checkCooldown, recordRequest, COOLDOWN_MS } from "./ratelimit";
import { registerUser } from "./users";

const PER_PAGE = 8;

interface SessionData {
  search?: string;
  page: number;
}

export type BotCtx = Context & SessionFlavor<SessionData>;

function filtered(search?: string): Restaurant[] {
  const rests = getRests();
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
    kb.text("✕ Сбросить поиск", "clear_search").row();
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

function helpText(): string {
  return `<b>Как получить скидку по карте Евразии:</b>

1️⃣ Нажмите /menu или кнопку «Выбрать ресторан»
2️⃣ Найдите свой ресторан в списке (или введите часть адреса)
3️⃣ Нажмите на ресторан — получите 4-значный код
4️⃣ Скажите официанту: «У меня <b>карта Евразии</b>»
5️⃣ Назовите код из бота

💲 <b>Карта Евразии</b> — скидка 30% на всё меню включая алкоголь 🍾
1️⃣➕1️⃣ Акция 1+1 в счастливые часы`;
}

function accountKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const acc of listAccounts()) {
    kb.text(`${acc.current ? "✅ " : ""}${acc.email}`, `account:${acc.index}`).row();
  }
  return kb;
}

function accountText(): string {
  const active = listAccounts().find((a) => a.current);
  return `🔑 Текущий аккаунт evrasia.rest: <b>${active?.email ?? "—"}</b>\n\nВыберите аккаунт для ручного переключения:`;
}

export function createBot(token: string, adminChatId?: number): Bot<BotCtx> {
  const bot = new Bot<BotCtx>(token);
  const isAdmin = (ctx: BotCtx) => adminChatId !== undefined && ctx.from?.id === adminChatId;

  bot.use(session<SessionData, BotCtx>({ initial: () => ({ page: 0 }) }));

  bot.command("start", async (ctx) => {
    const { id, first_name, username } = ctx.from!;
    registerUser(id, first_name, username).catch(console.error);

    await ctx.reply(
      `Добро пожаловать! 👋\n\nЭтот бот помогает получить код скидки по <b>карте Евразии</b> 🇯🇵\n\nВыберите ресторан — получите 4-значный код для официанта.`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("Выбрать ресторан", "open_menu")
          .row()
          .text("ℹ️ Инструкция", "show_help"),
      }
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

  bot.command("account", async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.reply(accountText(), { parse_mode: "HTML", reply_markup: accountKeyboard() });
  });

  bot.callbackQuery(/^account:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCallbackQuery();
      return;
    }
    const index = parseInt(ctx.match[1], 10);
    try {
      setCurrentAccount(index);
      await ctx.answerCallbackQuery("✅ Аккаунт переключён");
      await ctx.editMessageText(accountText(), { parse_mode: "HTML", reply_markup: accountKeyboard() });
    } catch (err) {
      console.error("setCurrentAccount error:", err);
      await ctx.answerCallbackQuery("❌ Не удалось переключить аккаунт");
    }
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
    const rest = getRests().find((r) => r.id === restId);
    if (!rest) {
      await ctx.answerCallbackQuery("Ресторан не найден");
      return;
    }

    const userId = ctx.from!.id;
    const remaining = checkCooldown(userId, restId);
    if (remaining > 0) {
      const mins = Math.floor(remaining / 60_000);
      const secs = Math.ceil((remaining % 60_000) / 1000);
      const waitStr = mins > 0 ? `${mins} мин ${secs} сек` : `${secs} сек`;
      await ctx.answerCallbackQuery(`⏳ Подождите ещё ${waitStr}`);
      return;
    }

    await ctx.answerCallbackQuery("⏳ Запрашиваю код...");

    try {
      const code = await requestCode(restId);

      if (code) {
        recordRequest(userId, restId);
        const nextTime = new Date(Date.now() + COOLDOWN_MS).toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        });

        if (adminChatId) {
          const { first_name, username } = ctx.from!;
          bot.api
            .sendMessage(
              adminChatId,
              `🔔 ${first_name}${username ? ` (@${username})` : ""} запросил код для «${rest.name}»`
            )
            .catch((err) => console.error("Failed to notify admin:", err));
        }

        await ctx.editMessageText(
          `✅ <b>${rest.name}</b>\n\nКод для официанта: <code>${code}</code>\n\n<i>Скажите официанту «Карта Евразии» и назовите этот код</i>\n\n🕐 Следующий запрос: <b>${nextTime}</b>`,
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
      if (err instanceof UpstreamError) {
        await ctx.reply("⚠️ Сайт ресторанов сейчас недоступен. Попробуйте через пару минут.");
      } else {
        await ctx.reply("❌ Произошла ошибка. Попробуйте позже.");
      }
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

  return bot;
}
