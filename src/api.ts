const BASE_URL = "https://evrasia.rest";
const AJAX_URL = `${BASE_URL}/bitrix/services/main/ajax.php?c=eurasia%3Asignin&action=process&mode=class`;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 8000;

// Thrown when evrasia.rest is unreachable, times out, or returns a non-JSON/error response —
// as opposed to a normal "session expired" / auth failure, which the caller should handle differently.
export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamError";
  }
}

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new UpstreamError(`Request to ${url} timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw new UpstreamError(`Request to ${url} failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw new UpstreamError(`Upstream returned HTTP ${res.status} for ${res.url}`);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UpstreamError(`Upstream returned non-JSON response for ${res.url}`);
  }
}

interface Account {
  email: string;
  password: string;
  cookies: string;
  loginPromise: Promise<void> | null;
}

let accounts: Account[] = [];
let currentAccountIndex = 0;

export function initAccounts(raw: string): void {
  accounts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf(":");
      if (idx === -1) throw new Error(`Invalid EVRASIA_ACCOUNTS entry: ${pair}`);
      return {
        email: pair.slice(0, idx).trim(),
        password: pair.slice(idx + 1).trim(),
        cookies: "",
        loginPromise: null,
      };
    });
  if (accounts.length === 0) throw new Error("No evrasia accounts configured in EVRASIA_ACCOUNTS");
  currentAccountIndex = 0;
}

function currentAccount(): Account {
  return accounts[currentAccountIndex];
}

function rotateAccount(): void {
  currentAccountIndex = (currentAccountIndex + 1) % accounts.length;
  console.log(`Switched to account #${currentAccountIndex + 1} (${currentAccount().email})`);
}

export interface AccountStatus {
  index: number;
  email: string;
  current: boolean;
}

export function listAccounts(): AccountStatus[] {
  return accounts.map((a, index) => ({ index, email: a.email, current: index === currentAccountIndex }));
}

// Lets an admin manually pin the active account instead of waiting for automatic rotation.
export function setCurrentAccount(index: number): void {
  if (index < 0 || index >= accounts.length) throw new Error(`Invalid account index: ${index}`);
  currentAccountIndex = index;
  console.log(`Admin switched to account #${currentAccountIndex + 1} (${currentAccount().email})`);
}

let cachedRests: Restaurant[] = [];
export const getRests = () => cachedRests;
export async function refreshRestaurants(): Promise<void> {
  const updated = await fetchRestaurants();
  cachedRests = updated;
  console.log(`Restaurant list updated: ${updated.length} restaurants`);
}

function parseCookies(headers: Headers): string {
  return ((headers as any).getSetCookie?.() as string[] ?? [])
    .map((h: string) => h.split(";")[0])
    .join("; ");
}

function mergeCookies(...parts: string[]): string {
  const map = new Map<string, string>();
  for (const part of parts) {
    for (const pair of part.split("; ")) {
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const k = pair.slice(0, eq).trim();
      if (k) map.set(k, pair.slice(eq + 1));
    }
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function getCsrfToken(cookies: string): Promise<string> {
  const res = await fetchWithTimeout(AJAX_URL, {
    method: "POST",
    redirect: "manual",
    headers: {
      "User-Agent": UA,
      "X-Requested-With": "XMLHttpRequest",
      Cookie: cookies,
      Referer: `${BASE_URL}/signin/`,
    },
    body: new FormData(),
  });
  const data = await readJson<{ errors?: { customData?: { csrf?: string } }[] }>(res);
  return data.errors?.[0]?.customData?.csrf ?? "";
}

function login(account: Account): Promise<void> {
  if (account.loginPromise) return account.loginPromise;
  account.loginPromise = doLogin(account).finally(() => {
    account.loginPromise = null;
  });
  return account.loginPromise;
}

// Logs in the account currently at the front of the rotation — used at boot to warm up
// a session before the first request comes in.
export function loginCurrentAccount(): Promise<void> {
  return login(currentAccount());
}

async function doLogin(account: Account): Promise<void> {
  // Step 1: get PHPSESSID from signin page
  const initRes = await fetchWithTimeout(`${BASE_URL}/signin/`, {
    headers: { "User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9" },
  });
  if (!initRes.ok) throw new UpstreamError(`Upstream returned HTTP ${initRes.status} for ${initRes.url}`);
  const initCookies = parseCookies(initRes.headers);

  // Step 2: get CSRF token (Bitrix rejects requests without it)
  const csrf = await getCsrfToken(initCookies);
  if (!csrf) throw new Error("Could not obtain CSRF token");
  console.log(`Got CSRF token for ${account.email}`);

  // Step 3: submit login form with CSRF
  const form = new FormData();
  form.append("AUTH_FORM", "Y");
  form.append("TYPE", "AUTH");
  form.append("BY", "EMAIL");
  form.append("backurl", "/signin/");
  form.append("USER_LOGIN", account.email);
  form.append("USER_PASSWORD", account.password);
  form.append("USER_REMEMBER", "Y");
  form.append("sessid", csrf);

  const loginRes = await fetchWithTimeout(AJAX_URL, {
    method: "POST",
    redirect: "manual",
    headers: {
      "User-Agent": UA,
      "Accept-Language": "ru-RU,ru;q=0.9",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: initCookies,
      Referer: `${BASE_URL}/signin/`,
    },
    body: form,
  });

  const loginCookies = parseCookies(loginRes.headers);
  const body = await readJson<{ status?: string; errors?: { message: string }[] }>(loginRes);

  if (body.status === "success") {
    account.cookies = mergeCookies(initCookies, loginCookies);
    console.log(`Login successful for ${account.email}`);
  } else {
    const msg = body.errors?.map((e) => e.message).join(", ") ?? "unknown";
    throw new Error(`Login failed for ${account.email}: ${msg}`);
  }
}

export interface Restaurant {
  id: number;
  name: string;
}

export async function fetchRestaurants(): Promise<Restaurant[]> {
  const account = currentAccount();
  if (!account.cookies) await login(account);

  const res = await fetchWithTimeout(`${BASE_URL}/account/`, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "ru-RU,ru;q=0.9",
      Cookie: account.cookies,
      Referer: BASE_URL,
    },
  });
  if (!res.ok) throw new UpstreamError(`Upstream returned HTTP ${res.status} for ${res.url}`);

  const html = await res.text();
  const selectMatch = html.match(/<select[^>]+name="REST_ID"[^>]*>([\s\S]*?)<\/select>/i);
  if (!selectMatch) throw new Error("Restaurant list not found in account page");

  const restaurants: Restaurant[] = [];
  const optionRe = /<option\s+value="(\d+)">([^<]+)<\/option>/gi;
  let m: RegExpExecArray | null;
  while ((m = optionRe.exec(selectMatch[1])) !== null) {
    restaurants.push({ id: parseInt(m[1], 10), name: m[2].trim() });
  }

  if (restaurants.length === 0) throw new Error("Parsed 0 restaurants — session may have expired");
  return restaurants;
}

// True when a backend `error` field carries actual content, as opposed to being
// absent/null or an empty object/array (which Bitrix sends on success).
function hasContent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return Boolean(v);
}

async function requestCodeFor(account: Account, restId: number): Promise<{ checkin?: string; error?: unknown }> {
  const res = await fetchWithTimeout(`${BASE_URL}/api/v1/restaurant-discount/?REST_ID=${restId}`, {
    method: "GET",
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "ru-RU,ru;q=0.9",
      "User-Agent": UA,
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "x-requested-with": "XMLHttpRequest",
      Cookie: account.cookies,
      Referer: `${BASE_URL}/account/`,
    },
  });
  return readJson<{ checkin?: string; error?: unknown }>(res);
}

// Requests a discount code for restId, rotating through configured accounts when the
// current one is rate-limited (backend responds with a populated `error` and no `checkin`).
export async function requestCode(restId: number): Promise<string> {
  for (let attempt = 0; attempt < accounts.length; attempt++) {
    const account = currentAccount();
    if (!account.cookies) await login(account);

    let data = await requestCodeFor(account, restId);

    if (!data.checkin && !hasContent(data.error)) {
      console.log(`Session likely expired for ${account.email}, re-logging in...`);
      await login(account);
      data = await requestCodeFor(account, restId);
    }

    if (data.checkin) return data.checkin;

    if (hasContent(data.error)) {
      console.log(`Account ${account.email} appears rate-limited (error: ${JSON.stringify(data.error)}), rotating...`);
      rotateAccount();
      continue;
    }

    return "";
  }

  console.error("All evrasia accounts are rate-limited or unavailable");
  return "";
}
