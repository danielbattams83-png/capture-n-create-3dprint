import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not available in this process.");
  process.exit(1);
}

const sql = neon(databaseUrl);
const script = readFileSync(new URL("../db/migrations/0001_jobs.sql", import.meta.url), "utf8");
const statements = script
  .split(/;\s*(?:\r?\n|$)/)
  .map((statement) => statement.replace(/--.*$/gm, "").trim())
  .filter(Boolean);

for (const statement of statements) {
  await sql.query(statement);
}

console.log(`Applied ${statements.length} jobs migration statements.`);
