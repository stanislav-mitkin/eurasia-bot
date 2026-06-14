const BASE_URL = "https://evrasia.rest";
const AJAX_URL = `${BASE_URL}/bitrix/services/main/ajax.php?c=eurasia%3Asignin&action=process&mode=class`;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

let sessionCookies = "";
let loginInProgress = false;

export const getSessionCookies = () => sessionCookies;

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
  const res = await fetch(AJAX_URL, {
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
  const data = (await res.json()) as { errors?: { customData?: { csrf?: string } }[] };
  return data.errors?.[0]?.customData?.csrf ?? "";
}

export async function login(email: string, password: string): Promise<void> {
  if (loginInProgress) return;
  loginInProgress = true;

  try {
    // Step 1: get PHPSESSID from signin page
    const initRes = await fetch(`${BASE_URL}/signin/`, {
      headers: { "User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9" },
    });
    const initCookies = parseCookies(initRes.headers);

    // Step 2: get CSRF token (Bitrix rejects requests without it)
    const csrf = await getCsrfToken(initCookies);
    if (!csrf) throw new Error("Could not obtain CSRF token");
    console.log("Got CSRF token");

    // Step 3: submit login form with CSRF
    const form = new FormData();
    form.append("AUTH_FORM", "Y");
    form.append("TYPE", "AUTH");
    form.append("BY", "EMAIL");
    form.append("backurl", "/signin/");
    form.append("USER_LOGIN", email);
    form.append("USER_PASSWORD", password);
    form.append("USER_REMEMBER", "Y");
    form.append("sessid", csrf);

    const loginRes = await fetch(AJAX_URL, {
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
    const body = (await loginRes.json()) as { status?: string; errors?: { message: string }[] };

    if (body.status === "success") {
      sessionCookies = mergeCookies(initCookies, loginCookies);
      console.log("Login successful");
    } else {
      const msg = body.errors?.map((e) => e.message).join(", ") ?? "unknown";
      throw new Error(`Login failed: ${msg}`);
    }
  } finally {
    loginInProgress = false;
  }
}

export interface Restaurant {
  id: number;
  name: string;
}

export async function fetchRestaurants(): Promise<Restaurant[]> {
  const res = await fetch(`${BASE_URL}/account/`, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "ru-RU,ru;q=0.9",
      Cookie: sessionCookies,
      Referer: BASE_URL,
    },
  });

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

export async function requestCode(
  restId: number,
  email: string,
  password: string
): Promise<string> {
  const doRequest = async () =>
    fetch(`${BASE_URL}/api/v1/restaurant-discount/?REST_ID=${restId}`, {
      method: "GET",
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "ru-RU,ru;q=0.9",
        "User-Agent": UA,
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "x-requested-with": "XMLHttpRequest",
        Cookie: sessionCookies,
        Referer: `${BASE_URL}/account/`,
      },
    });

  let res = await doRequest();
  let data = (await res.json()) as { checkin?: string };

  if (!data.checkin) {
    console.log("Session likely expired, re-logging in...");
    await login(email, password);
    res = await doRequest();
    data = (await res.json()) as { checkin?: string };
  }

  return data.checkin ?? "";
}
