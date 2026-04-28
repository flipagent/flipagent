import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config.js";
import * as schema from "./schema.js";

const queryClient = postgres(config.DATABASE_URL, {
	max: config.NODE_ENV === "production" ? 10 : 4,
	idle_timeout: 20,
});

export const db = drizzle(queryClient, { schema });
export type Db = typeof db;
export { schema };

export async function closeDb(): Promise<void> {
	await queryClient.end({ timeout: 5 });
}
