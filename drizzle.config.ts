import "dotenv/config";
import { defineConfig } from "drizzle-kit";

/**
 * Works locally and on Render. Render injects DATABASE_URL from the managed
 * PostgreSQL service during build and runtime; no host or password is
 * hardcoded into the repository.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://trade_database_sb3f_user:82BDk6DS3vlYObPclvOhaD6tPpHP4fit@dpg-daptr92d0e5s73adftvg-a/trade_database_sb3f",
  },
  strict: true,
  verbose: true,
});
