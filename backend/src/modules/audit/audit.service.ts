import { pool, type Db } from '../../database/pool.js'
import { logger } from '../../lib/logger.js'

export interface AuditEntry {
  actorId?: string | null
  action: string
  targetType?: string
  targetId?: string
  level?: 'INFO' | 'WARN' | 'ERROR'
  details?: Record<string, unknown>
  ip?: string
}

/** Append-only audit trail. Never throws into the caller — an audit failure is logged, not fatal. */
export async function audit(entry: AuditEntry, db: Db = pool) {
  try {
    await db.query(
      `INSERT INTO audit_logs (actor_id, action, target_type, target_id, level, details, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [entry.actorId ?? null, entry.action, entry.targetType ?? null, entry.targetId ?? null, entry.level ?? 'INFO', entry.details ?? {}, entry.ip ?? null],
    )
  } catch (err) {
    logger.error({ err, action: entry.action }, 'failed to write audit log')
  }
}
