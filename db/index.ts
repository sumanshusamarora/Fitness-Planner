import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://fitness:fitness@localhost:5434/fitness";

const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });
