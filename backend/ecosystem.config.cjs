// PM2 cluster config for 1000-user concurrency.
// Usage:
//   pm2 start ecosystem.config.cjs          (production — all CPU cores)
//   pm2 start ecosystem.config.cjs --env staging
//   pm2 logs lms-api
//
// Architecture:
//   lms-api      — N cluster workers (one per CPU core) handle HTTP traffic.
//                  Each worker gets its own Prisma pool (DB_POOL_SIZE connections).
//                  Total DB connections = DB_POOL_SIZE × num_cores.
//                  With 4 cores × 100 pool = 400 connections — ensure MySQL
//                  max_connections is set to at least 500 on the DB server.
//
//   lms-worker   — Single process that runs background schedulers
//                  (LMS_RUN_SCHEDULERS=true). Kept out of the cluster so
//                  cron-style jobs don't fire N times.

module.exports = {
  apps: [
    {
      name: 'lms-api',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 'max', // one per CPU core
      exec_mode: 'cluster',
      node_args: '--max-old-space-size=512',
      env: {
        NODE_ENV: 'production',
        PORT: 8000,
        LMS_RUN_SCHEDULERS: 'false',
        // Keep per-worker pool small when running many workers so total
        // DB connections stay within MySQL max_connections. Override with
        // DB_POOL_SIZE env var on the server if needed.
        DB_POOL_SIZE: '100',
        DB_POOL_TIMEOUT: '20',
        DB_CONNECT_TIMEOUT: '10',
        // Cache: 20 s TTL, max 5000 sessions in RAM per worker
        SESSION_CACHE_TTL_MS: '20000',
        SESSION_CACHE_MAX: '5000',
      },
      // Reload workers one at a time on deploy — no downtime.
      wait_ready: false,
      listen_timeout: 10000,
      kill_timeout: 5000,
      // Restart if worker exceeds 400 MB RSS (memory leak guard)
      max_memory_restart: '400M',
      out_file: '/var/www/mcn-lms/backend/lms-out.log',
      error_file: '/var/www/mcn-lms/backend/lms-err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
    {
      name: 'lms-worker',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      node_args: '--max-old-space-size=256',
      env: {
        NODE_ENV: 'production',
        PORT: 8001, // not exposed publicly; only internal health checks
        LMS_RUN_SCHEDULERS: 'true',
        DB_POOL_SIZE: '20',
        DB_POOL_TIMEOUT: '20',
        SESSION_CACHE_TTL_MS: '20000',
        SESSION_CACHE_MAX: '1000',
      },
      max_memory_restart: '256M',
      out_file: '/var/www/mcn-lms/backend/lms-worker-out.log',
      error_file: '/var/www/mcn-lms/backend/lms-worker-err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
