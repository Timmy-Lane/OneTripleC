import { db } from '../db.js';
import { users } from '../models/schema.js';
import { eq, and } from 'drizzle-orm';

export interface CreateUserInput {
  telegramId: number;
  telegramUsername?: string;
  telegramFirstName?: string;
  authProvider?: string;
  authProviderId?: string;
}

export async function createUser(input: CreateUserInput) {
  const [user] = await db
    .insert(users)
    .values({
      telegramId: input.telegramId,
      telegramUsername: input.telegramUsername,
      telegramFirstName: input.telegramFirstName,
      authProvider: input.authProvider || 'telegram',
      authProviderId: input.authProviderId || input.telegramId.toString(),
    })
    .returning();

  return user;
}

export async function findUserByTelegramId(telegramId: number) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, telegramId))
    .limit(1);

  return user || null;
}

export async function findOrCreateUser(input: CreateUserInput) {
  const existingUser = await findUserByTelegramId(input.telegramId);

  if (existingUser) {
    return existingUser;
  }

  return createUser(input);
}

export async function findAllUsers() {
  return db.select().from(users);
}

export async function findUserByAuthProvider(
  provider: string,
  providerId: string
) {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.authProvider, provider), eq(users.authProviderId, providerId)))
    .limit(1);

  return user || null;
}
