import pg from 'pg';

const { Pool } = pg;
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
let pool = null;
let schemaPromise = null;
let lastError = null;
let lastOkAt = null;

export function isPostgresConfigured() {
  return Boolean(DATABASE_URL);
}

function getPool() {
  if (!DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: Math.max(2, Math.min(10, Number(process.env.POSTGRES_POOL_MAX || 6) || 6)),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 4_000,
      application_name: 'm7md-arabic-resolver',
    });
    pool.on('error', error => {
      lastError = String(error?.message || error).slice(0, 240);
      console.warn('[postgres:pool]', lastError);
    });
  }
  return pool;
}

async function createSchema(target) {
  await target.query(`
    CREATE TABLE IF NOT EXISTS m7md_vault_subtitles (
      id TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await target.query(`
    CREATE INDEX IF NOT EXISTS m7md_vault_subtitles_updated_idx
    ON m7md_vault_subtitles (updated_at DESC)
  `);
  await target.query(`
    CREATE TABLE IF NOT EXISTS m7md_version_registry_state (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  lastError = null;
  lastOkAt = new Date().toISOString();
}

export async function ensureEnterpriseSchema(client = null) {
  if (!DATABASE_URL) return false;
  if (client) {
    await createSchema(client);
    return true;
  }
  if (!schemaPromise) {
    schemaPromise = createSchema(getPool()).catch(error => {
      schemaPromise = null;
      lastError = String(error?.message || error).slice(0, 240);
      throw error;
    });
  }
  await schemaPromise;
  return true;
}

export async function queryDatabase(text, params = []) {
  const target = getPool();
  if (!target) throw new Error('DATABASE_URL is not configured');
  await ensureEnterpriseSchema();
  try {
    const result = await target.query(text, params);
    lastError = null;
    lastOkAt = new Date().toISOString();
    return result;
  } catch (error) {
    lastError = String(error?.message || error).slice(0, 240);
    throw error;
  }
}

export async function withDatabaseTransaction(callback) {
  const target = getPool();
  if (!target) throw new Error('DATABASE_URL is not configured');
  const client = await target.connect();
  try {
    await ensureEnterpriseSchema(client);
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    lastError = null;
    lastOkAt = new Date().toISOString();
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    lastError = String(error?.message || error).slice(0, 240);
    throw error;
  } finally {
    client.release();
  }
}

export async function pingDatabase() {
  if (!DATABASE_URL) return { configured: false, ok: false };
  const started = Date.now();
  try {
    await queryDatabase('SELECT 1 AS ok');
    return { configured: true, ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return { configured: true, ok: false, latencyMs: Date.now() - started, error: String(error?.message || error).slice(0, 160) };
  }
}

export function getDatabaseStatus() {
  return {
    configured: Boolean(DATABASE_URL),
    backend: DATABASE_URL ? 'postgres' : 'local-file',
    pool: pool ? { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount } : null,
    lastOkAt,
    lastError,
  };
}

export async function closePostgres() {
  if (!pool) return;
  const current = pool;
  pool = null;
  schemaPromise = null;
  await current.end();
}
