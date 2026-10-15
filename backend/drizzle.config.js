import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.js',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgres://endurance:endurance@localhost:5432/endurance_dev',
  },
});
