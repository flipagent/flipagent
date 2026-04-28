import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required for drizzle-kit");

export default defineConfig({
	schema: "./src/db/schema.ts",
	out: "./drizzle",
	dialect: "postgresql",
	dbCredentials: { url },
	strict: true,
	verbose: true,
});
