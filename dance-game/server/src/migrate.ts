import { databaseCaFile } from "./dbCa.ts";
import { PgStore } from "./pgStore.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Set DATABASE_URL (see .env.example) before migrating.");
  process.exit(1);
}

const store = new PgStore(databaseUrl, databaseCaFile());
try {
  await store.migrate();
  console.log("Schema is up to date.");
} finally {
  await store.close();
}
