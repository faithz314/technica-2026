import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * CA bundle for the database's TLS certificate: `DATABASE_CA_FILE` if set,
 * otherwise the Tiger Data (Timescale) root CA checked into `server/certs/`.
 */
export function databaseCaFile(): string {
  if (process.env.DATABASE_CA_FILE) return process.env.DATABASE_CA_FILE;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../certs/timescale-ca.pem");
}
