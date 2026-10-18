import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";
import { databaseCaFile } from "./dbCa.ts";
import { MemoryStore } from "./memoryStore.ts";
import { PgStore } from "./pgStore.ts";
import type { Store } from "./store.ts";

const port = Number(process.env.PORT ?? 8787);
const databaseUrl = process.env.DATABASE_URL;

let store: Store;
if (databaseUrl) {
  const pgStore = new PgStore(databaseUrl, databaseCaFile());
  // Cheap and idempotent, so a fresh Tiger Data service works on first boot.
  await pgStore.migrate();
  store = pgStore;
  console.log("Storage: Postgres (DATABASE_URL)");
} else {
  store = new MemoryStore();
  console.warn("Storage: in-memory. Set DATABASE_URL to persist accounts and scores.");
}

const here = path.dirname(fileURLToPath(import.meta.url));
const app = createApp({
  store,
  secureCookies: process.env.NODE_ENV === "production",
  staticDir: path.resolve(here, "../../dist"),
});

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`API listening on http://127.0.0.1:${port}`);
});

async function shutdown() {
  server.close();
  await store.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
