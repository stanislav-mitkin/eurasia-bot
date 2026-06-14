import { put, list } from "@vercel/blob";

export interface UserRecord {
  chatId: number;
  firstName?: string;
  username?: string;
  startedAt: string;
}

const FILENAME = "users.json";

async function readUsers(): Promise<UserRecord[]> {
  const { blobs } = await list({ prefix: FILENAME });
  if (blobs.length === 0) return [];
  const res = await fetch(blobs[0].downloadUrl);
  return res.json() as Promise<UserRecord[]>;
}

async function writeUsers(users: UserRecord[]): Promise<void> {
  await put(FILENAME, JSON.stringify(users), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json",
  });
}

export async function registerUser(
  chatId: number,
  firstName?: string,
  username?: string
): Promise<void> {
  const users = await readUsers();
  if (users.some((u) => u.chatId === chatId)) return;
  users.push({ chatId, firstName, username, startedAt: new Date().toISOString() });
  await writeUsers(users);
}

export async function getAllUsers(): Promise<UserRecord[]> {
  return readUsers();
}
