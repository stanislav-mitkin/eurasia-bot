import { put, list } from "@vercel/blob";

export interface UserRecord {
  chatId: number;
  firstName?: string;
  username?: string;
  startedAt: string;
}

const FILENAME = "users.json";

async function readUsers(): Promise<UserRecord[]> {
  try {
    const { blobs } = await list({ prefix: FILENAME });
    if (blobs.length === 0) return [];
    const token = process.env.BLOB_READ_WRITE_TOKEN ?? "";
    const res = await fetch(blobs[0].url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.error("readUsers: fetch failed", res.status);
      return [];
    }
    return (await res.json()) as UserRecord[];
  } catch (err) {
    console.error("readUsers error:", err);
    return [];
  }
}

async function writeUsers(users: UserRecord[]): Promise<void> {
  await put(FILENAME, JSON.stringify(users), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function registerUser(
  chatId: number,
  firstName?: string,
  username?: string
): Promise<void> {
  const users = await readUsers();

  if (users.some((u) => u.chatId === chatId)) {
    console.log(`registerUser: chatId ${chatId} already exists`);
    return;
  }

  users.push({ chatId, firstName, username, startedAt: new Date().toISOString() });
  await writeUsers(users);
  console.log(`registerUser: saved chatId ${chatId} (${firstName}), total: ${users.length}`);
}

export async function getAllUsers(): Promise<UserRecord[]> {
  return readUsers();
}
