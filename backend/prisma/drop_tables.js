import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

const client = new Client({ connectionString: process.env.DIRECT_URL });
await client.connect();

const res = await client.query(`
  SELECT tablename FROM pg_tables WHERE schemaname = 'public'
`);

console.log('Tables found:', res.rows.map(r => r.tablename));

await client.query(`
  DO $$ DECLARE r RECORD;
  BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
      EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP;
  END $$;
`);

const res2 = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
console.log('Tables remaining:', res2.rows.length);
await client.end();
