import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;

const client = new Client({ connectionString: process.env.DIRECT_URL });
await client.connect();

// Drop all enums in public schema
const enums = await client.query(`SELECT typname FROM pg_type WHERE typcategory = 'E' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')`);
console.log('Enums:', enums.rows.map(r => r.typname));
for (const row of enums.rows) {
  await client.query(`DROP TYPE IF EXISTS public.${row.typname} CASCADE`);
}

// Drop all functions in public schema
const funcs = await client.query(`SELECT proname, oid FROM pg_proc WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')`);
console.log('Functions:', funcs.rows.map(r => r.proname));
for (const row of funcs.rows) {
  await client.query(`DROP FUNCTION IF EXISTS public.${row.proname} CASCADE`);
}

console.log('All enums and functions dropped.');
await client.end();
