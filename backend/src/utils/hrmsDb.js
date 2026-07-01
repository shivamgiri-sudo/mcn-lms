import mysql from 'mysql2/promise';

let pool = null;

function getConfig() {
  return {
    host: process.env.HRMS_DB_HOST || '192.168.10.6',
    port: parseInt(process.env.HRMS_DB_PORT || '3306', 10),
    user: process.env.HRMS_DB_USER || 'shivam_user',
    password: process.env.HRMS_DB_PASS || 'qwersdfg!@#hjk',
    database: process.env.HRMS_DB_NAME || 'mas_hrms',
    waitForConnections: true,
    connectionLimit: 2,
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
