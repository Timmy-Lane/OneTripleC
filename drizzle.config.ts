import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/persistence/models/schema.ts',
  out: './src/persistence/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
