import { db } from '../db.js';
import { users } from '../models/schema.js';
import { eq } from 'drizzle-orm';

export interface CreateUserInput {
  telegramId: number;
  telegramUsername?: string;
  telegramFirstName?: string;
}

export async function createUser(input: CreateUserInput) {
  const [user] = await db
    .insert(users)
    .values({
      telegramId: input.telegramId,
      telegramUsername: input.telegramUsername,
      telegramFirstName: input.telegramFirstName,
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
