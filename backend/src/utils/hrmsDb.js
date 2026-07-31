import mysql from 'mysql2/promise';

let pool = null;

const REQUIRED_HRMS_ENV = ['HRMS_DB_HOST', 'HRMS_DB_USER', 'HRMS_DB_PASS', 'HRMS_DB_NAME'];

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required HRMS configuration: ${name}`);
  return value;
}

function getConfig() {
  const missing = REQUIRED_HRMS_ENV.filter(name => !String(process.env[name] || '').trim());
  if (missing.length) {
    throw new Error(`HRMS database integration is not configured. Missing: ${missing.join(', ')}`);
  }

  const port = Number.parseInt(process.env.HRMS_DB_PORT || '3306', 10);
  const connectionLimit = Number.parseInt(process.env.HRMS_DB_CONNECTION_LIMIT || '5', 10);

  return {
    host: requiredEnv('HRMS_DB_HOST'),
    port: Number.isFinite(port) ? port : 3306,
    user: requiredEnv('HRMS_DB_USER'),
    password: requiredEnv('HRMS_DB_PASS'),
    database: requiredEnv('HRMS_DB_NAME'),
    waitForConnections: true,
    connectionLimit: Number.isFinite(connectionLimit) && connectionLimit > 0 ? connectionLimit : 5,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    charset: 'utf8mb4',
  };
}

export async function getHrmsPool() {
  if (!pool) {
    pool = mysql.createPool(getConfig());
  }
  return pool;
}

export async function queryHrms(sql, params = []) {
  const p = await getHrmsPool();
  const [rows] = await p.execute(sql, params);
  return rows;
}

export async function closeHrmsPool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
