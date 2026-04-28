import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { config } from "../config.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(here, "..", "..", "drizzle");

async function main() {
	const client = postgres(config.DATABASE_URL, { max: 1 });
	const db = drizzle(client);
	console.log(`migrating ${config.DATABASE_URL.replace(/:[^:@]+@/, ":***@")}`);
	await migrate(db, { migrationsFolder });
	await client.end({ timeout: 5 });
	console.log("migrations done");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
