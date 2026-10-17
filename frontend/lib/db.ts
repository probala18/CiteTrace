import { createClient, Client } from "@libsql/client";

let client: Client | null = null;
let initialized = false;

export function getDb(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL || "file:evidence.db";
    const authToken = process.env.TURSO_AUTH_TOKEN;
    client = createClient({
      url,
      authToken,
    });
  }
  return client;
}

export async function initDb(): Promise<Client> {
  const db = getDb();
  if (initialized) return db;

  await db.execute(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      file_type TEXT NOT NULL,
      content_sha256 TEXT NOT NULL,
      page_count INTEGER,
      chunk_count INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      page_number INTEGER,
      heading TEXT,
      text TEXT NOT NULL,
      embedding TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
    );
  `);

  initialized = true;
  return db;
}
