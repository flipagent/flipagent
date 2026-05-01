import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config.js";
import * as schema from "./schema.js";

const queryClient = postgres(config.DATABASE_URL, {
	max: config.NODE_ENV === "production" ? 10 : 4,
	idle_timeout: 20,
	// Cap how long postgres.js waits for a brand-new connection.
	// Default is 30s; 10s fails network partitions fast enough that a
	// downstream caller's `awaitTerminal` deadline (4 min) doesn't get
	// silently eaten by a stuck handshake. postgres.js doesn't expose
	// per-query timeouts; mid-query hangs still rely on TCP keepalives.
	connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema });
export type Db = typeof db;
export { schema };

export async function closeDb(): Promise<void> {
	await queryClient.end({ timeout: 5 });
}
