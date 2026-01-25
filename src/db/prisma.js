import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import pkg from "../../generated/prisma/index.js";
import { env } from "../config/env.js";

const { PrismaClient } = pkg;
const { Pool } = pg;

// Prisma 7 uses the "client" engine by default, which requires either:
// - a Driver Adapter (direct DB connection), OR
// - Accelerate (accelerateUrl)
//
// We use the Postgres driver adapter.
const pool = new Pool({ connectionString: env.databaseUrl });
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });
