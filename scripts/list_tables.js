import pkg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const { Client } = pkg;

async function main(){
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const res = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public';");
  console.log(res.rows.map(r=>r.tablename).join('\n'));
  await client.end();
}
main().catch((e)=>{ console.error(e); process.exit(1); });
