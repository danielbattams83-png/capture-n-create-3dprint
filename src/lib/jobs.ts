import "server-only";

import { Pool, type PoolClient } from "@neondatabase/serverless";
import { deleteTemporaryBlobs } from "@/lib/blob-uploads";
import { createTaskToken, MeshyApiError, type MeshyTaskType } from "@/lib/meshy";

export type JobType = "model" | "texture";
export type JobStatus = "queued" | "processing" | "succeeded" | "failed";

export type JobOutputUrls = {
  glb?: string;
  stl?: string;
};

export type JobRecord = {
  id: string;
  userId: string;
  idempotencyKey: string;
  meshyTaskId: string | null;
  meshyTaskType: MeshyTaskType | null;
  type: JobType;
  status: JobStatus;
  progress: number;
  inputUrls: string[];
  outputUrls: JobOutputUrls | null;
  parameters: Record<string, unknown>;
  error: string | null;
  updatedAt: string;
};

export type PublicJob = {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  meshyTaskId: string | null;
  meshyTaskType: MeshyTaskType | null;
  taskToken: string | null;
  inputUrls: string[];
  outputUrls: JobOutputUrls | null;
  error: string | null;
  updatedAt: string;
};

type JobRow = {
  id: string;
  user_id: string;
  idempotency_key: string;
  meshy_task_id: string | null;
  meshy_task_type: string | null;
  type: string;
  status: string;
  progress: number;
  input_urls: unknown;
  output_urls: unknown;
  parameters: unknown;
  error: string | null;
  updated_at: Date | string;
};

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS jobs (
    id uuid PRIMARY KEY,
    user_id text NOT NULL,
    idempotency_key text NOT NULL,
    meshy_task_id text,
    meshy_task_type text,
    type text NOT NULL,
    status text NOT NULL,
    progress integer NOT NULL DEFAULT 0,
    input_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
    output_urls jsonb,
    parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT jobs_type_check CHECK (type IN ('model', 'texture')),
    CONSTRAINT jobs_status_check CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
    CONSTRAINT jobs_progress_check CHECK (progress >= 0 AND progress <= 100),
    CONSTRAINT jobs_task_type_check CHECK (
      meshy_task_type IS NULL
      OR meshy_task_type IN ('image-to-3d', 'multi-image-to-3d', 'retexture')
    ),
    CONSTRAINT jobs_user_idempotency_key UNIQUE (user_id, idempotency_key)
  )`,
  `CREATE INDEX IF NOT EXISTS jobs_user_type_updated_idx
    ON jobs (user_id, type, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS jobs_meshy_task_id_idx
    ON jobs (meshy_task_id)`,
  `CREATE INDEX IF NOT EXISTS jobs_user_active_idx
    ON jobs (user_id)
    WHERE status IN ('queued', 'processing')`,
  `CREATE TABLE IF NOT EXISTS request_rates (
    id uuid PRIMARY KEY,
    user_id text NOT NULL,
    action text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS request_rates_lookup_idx
    ON request_rates (user_id, action, created_at DESC)`,
];

export const MAX_ACTIVE_JOBS = 2;

const GENERATION_RATE_WINDOW_MS = 10 * 60 * 1000;
const GENERATION_RATE_LIMIT = 8;

const RECENT_SUCCESS_MS = 24 * 60 * 60 * 1000;
const IN_FLIGHT_CLAIM_MS = 60 * 1000;

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function databaseUrl(): string {
  const url = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
  if (!url) {
    throw new Error("DATABASE_URL is not configured.");
  }
  return url;
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: databaseUrl(), max: 1 });
  }
  return pool;
}

export function ensureJobsSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const client = await getPool().connect();
      try {
        for (const statement of SCHEMA_STATEMENTS) {
          await client.query(statement);
        }
      } catch (error) {
        schemaReady = null;
        throw error;
      } finally {
        client.release();
      }
    })();
  }
  return schemaReady;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asStringArray(value: unknown): string[] {
  const parsed = typeof value === "string" ? safeParse(value) : value;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asOutputUrls(value: unknown): JobOutputUrls | null {
  const record = asRecord(value);
  if (!record) return null;
  const glb = typeof record.glb === "string" ? record.glb : undefined;
  const stl = typeof record.stl === "string" ? record.stl : undefined;
  return glb || stl ? { glb, stl } : null;
}

function asTaskType(value: string | null): MeshyTaskType | null {
  if (value === "image-to-3d" || value === "multi-image-to-3d" || value === "retexture") {
    return value;
  }
  return null;
}

function mapJob(row: JobRow): JobRecord {
  const updatedAt = row.updated_at instanceof Date
    ? row.updated_at.toISOString()
    : new Date(row.updated_at).toISOString();
  return {
    id: row.id,
    userId: row.user_id,
    idempotencyKey: row.idempotency_key,
    meshyTaskId: row.meshy_task_id,
    meshyTaskType: asTaskType(row.meshy_task_type),
    type: row.type === "texture" ? "texture" : "model",
    status: row.status as JobStatus,
    progress: Number(row.progress) || 0,
    inputUrls: asStringArray(row.input_urls),
    outputUrls: asOutputUrls(row.output_urls),
    parameters: asRecord(row.parameters) ?? {},
    error: row.error,
    updatedAt,
  };
}

export function toPublicJob(job: JobRecord): PublicJob {
  const taskToken = job.meshyTaskId && job.meshyTaskType
    ? createTaskToken(job.meshyTaskId, job.meshyTaskType, job.inputUrls)
    : null;
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    meshyTaskId: job.meshyTaskId,
    meshyTaskType: job.meshyTaskType,
    taskToken,
    inputUrls: job.inputUrls,
    outputUrls: job.outputUrls,
    error: job.error,
    updatedAt: job.updatedAt,
  };
}

function isReusable(job: JobRecord): boolean {
  if (job.meshyTaskId && (job.status === "queued" || job.status === "processing")) return true;
  if (job.status !== "succeeded") return false;
  return Date.now() - Date.parse(job.updatedAt) < RECENT_SUCCESS_MS;
}

function isFreshClaim(job: JobRecord): boolean {
  return job.status === "queued"
    && !job.meshyTaskId
    && Date.now() - Date.parse(job.updatedAt) < IN_FLIGHT_CLAIM_MS;
}

async function readLockedJob(
  client: PoolClient,
  userId: string,
  idempotencyKey: string,
): Promise<JobRecord | null> {
  const result = await client.query<JobRow>(
    `SELECT * FROM jobs WHERE user_id = $1 AND idempotency_key = $2 FOR UPDATE`,
    [userId, idempotencyKey],
  );
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

async function getJobById(userId: string, jobId: string): Promise<JobRecord | null> {
  const result = await getPool().query<JobRow>(
    `SELECT * FROM jobs WHERE user_id = $1 AND id = $2`,
    [userId, jobId],
  );
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

async function waitForInFlightJob(userId: string, jobId: string): Promise<JobRecord | null> {
  const deadline = Date.now() + 35_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const job = await getJobById(userId, jobId);
    if (!job) return null;
    if (job.meshyTaskId || job.status === "failed" || job.status === "succeeded") return job;
  }
  return getJobById(userId, jobId);
}

async function saveQueuedJob(
  client: PoolClient,
  input: {
    id: string;
    userId: string;
    idempotencyKey: string;
    type: JobType;
    inputUrls: string[];
    parameters: Record<string, unknown>;
    exists: boolean;
  },
): Promise<void> {
  const parameters = JSON.stringify(input.parameters);
  const inputUrls = JSON.stringify(input.inputUrls);
  if (input.exists) {
    await client.query(
      `UPDATE jobs
       SET status = 'queued',
           progress = 0,
           meshy_task_id = NULL,
           meshy_task_type = NULL,
           input_urls = $2::jsonb,
           output_urls = NULL,
           parameters = $3::jsonb,
           error = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [input.id, inputUrls, parameters],
    );
    return;
  }

  await client.query(
    `INSERT INTO jobs (
       id, user_id, idempotency_key, type, status, progress, input_urls, parameters
     ) VALUES ($1, $2, $3, $4, 'queued', 0, $5::jsonb, $6::jsonb)`,
    [input.id, input.userId, input.idempotencyKey, input.type, inputUrls, parameters],
  );
}

type RateLimitDecision = { allowed: boolean; retryAfterSeconds: number };

async function consumeRateLimitOn(
  client: PoolClient,
  input: { userId: string; action: string; limit: number; windowMs: number },
): Promise<RateLimitDecision> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    `rate:${input.userId}:${input.action}`,
  ]);
  const existing = await client.query<{ count: number; oldest: Date | string | null }>(
    `SELECT count(*)::int AS count, min(created_at) AS oldest
     FROM request_rates
     WHERE user_id = $1
       AND action = $2
       AND created_at > NOW() - ($3::int * INTERVAL '1 millisecond')`,
    [input.userId, input.action, input.windowMs],
  );
  const count = Number(existing.rows[0]?.count ?? 0);
  if (count >= input.limit) {
    const oldest = existing.rows[0]?.oldest;
    const oldestMs = oldest ? new Date(oldest).getTime() : Date.now();
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldestMs + input.windowMs - Date.now()) / 1000)),
    };
  }

  await client.query(
    `INSERT INTO request_rates (id, user_id, action) VALUES ($1, $2, $3)`,
    [crypto.randomUUID(), input.userId, input.action],
  );
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function consumeRateLimit(input: {
  userId: string;
  action: string;
  limit: number;
  windowMs: number;
}): Promise<RateLimitDecision> {
  await ensureJobsSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const decision = await consumeRateLimitOn(client, input);
    await client.query("COMMIT");
    return decision;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteExpiredRateLimits(): Promise<number> {
  await ensureJobsSchema();
  const result = await getPool().query(
    `DELETE FROM request_rates WHERE created_at < NOW() - INTERVAL '1 hour'`,
  );
  return result.rowCount ?? 0;
}

export async function beginGenerationJob(
  input: {
    userId: string;
    idempotencyKey: string;
    type: JobType;
    inputUrls: string[];
    parameters: Record<string, unknown>;
    submit: () => Promise<{ meshyTaskId: string; meshyTaskType: MeshyTaskType }>;
  },
  attempt = 0,
): Promise<{ job: JobRecord; reused: boolean }> {
  await ensureJobsSchema();
  const client = await getPool().connect();
  let ownedJobId: string | null = null;
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`studio:${input.userId}`]);
    const existing = await readLockedJob(client, input.userId, input.idempotencyKey);
    if (existing && isReusable(existing)) {
      await client.query("COMMIT");
      return { job: existing, reused: true };
    }
    if (existing && isFreshClaim(existing)) {
      await client.query("COMMIT");
      const waited = await waitForInFlightJob(input.userId, existing.id);
      if (waited && (waited.meshyTaskId || waited.status === "succeeded" || waited.status === "failed")) {
        return { job: waited, reused: true };
      }
      if (attempt >= 2) {
        throw new Error("Generation is still starting. Resume the existing job in a moment.");
      }
      return beginGenerationJob(input, attempt + 1);
    }

    const activeJobs = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM jobs
       WHERE user_id = $1
         AND status IN ('queued', 'processing')
         AND idempotency_key <> $2`,
      [input.userId, input.idempotencyKey],
    );
    if (Number(activeJobs.rows[0]?.count ?? 0) >= MAX_ACTIVE_JOBS) {
      throw new MeshyApiError(
        "Two generations are already running for this session. Resume or wait for one to finish.",
        429,
      );
    }
    const rateLimit = await consumeRateLimitOn(client, {
      userId: input.userId,
      action: input.type === "model" ? "model-generation" : "texture-generation",
      limit: GENERATION_RATE_LIMIT,
      windowMs: GENERATION_RATE_WINDOW_MS,
    });
    if (!rateLimit.allowed) {
      throw new MeshyApiError(
        "Too many generation requests. Try again shortly.",
        429,
        rateLimit.retryAfterSeconds,
      );
    }

    ownedJobId = existing?.id ?? crypto.randomUUID();
    await saveQueuedJob(client, {
      id: ownedJobId,
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      type: input.type,
      inputUrls: input.inputUrls,
      parameters: input.parameters,
      exists: Boolean(existing),
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  try {
    if (!ownedJobId) throw new Error("The generation job could not be reserved.");
    const submitted = await input.submit();
    const updated = await getPool().query<JobRow>(
      `UPDATE jobs
       SET meshy_task_id = $2,
           meshy_task_type = $3,
           status = 'processing',
           progress = 0,
           error = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [ownedJobId, submitted.meshyTaskId, submitted.meshyTaskType],
    );
    const row = updated.rows[0];
    if (!row) throw new Error("The generation job could not be saved.");
    return { job: mapJob(row), reused: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The generation task could not be created.";
    const failed = await getPool().query<{ input_urls: unknown }>(
      `UPDATE jobs
       SET status = 'failed', error = $2, updated_at = NOW()
       WHERE id = $1
         AND meshy_task_id IS NULL
         AND status IN ('queued', 'processing')
       RETURNING input_urls`,
      [ownedJobId, message.slice(0, 500)],
    );
    const inputUrls = failed.rows.flatMap((row) => asStringArray(row.input_urls));
    if (inputUrls.length > 0) await deleteTemporaryBlobs(inputUrls);
    throw error;
  }
}

export async function listResumableJobs(userId: string): Promise<JobRecord[]> {
  await ensureJobsSchema();
  const result = await getPool().query<JobRow>(
    `SELECT * FROM jobs
     WHERE user_id = $1
       AND (
         status IN ('queued', 'processing')
         OR (status = 'succeeded' AND updated_at > NOW() - INTERVAL '2 hours')
       )
     ORDER BY updated_at DESC`,
    [userId],
  );
  const jobs = result.rows.map(mapJob).filter((job) => job.meshyTaskId);
  const picked: JobRecord[] = [];
  for (const type of ["model", "texture"] as const) {
    const ofType = jobs.filter((job) => job.type === type);
    const live = ofType.find((job) => job.status === "queued" || job.status === "processing");
    const chosen = live ?? ofType.find((job) => job.status === "succeeded");
    if (chosen) picked.push(chosen);
  }
  return picked;
}

export async function syncJobFromMeshy(input: {
  meshyTaskId: string;
  status: JobStatus;
  progress: number;
  outputUrls?: JobOutputUrls | null;
  error?: string | null;
}): Promise<void> {
  try {
    await ensureJobsSchema();
    const updated = await getPool().query<{ input_urls: unknown }>(
      `UPDATE jobs
       SET status = $2,
           progress = $3,
           output_urls = COALESCE($4::jsonb, output_urls),
           error = $5,
           updated_at = NOW()
       WHERE meshy_task_id = $1
         AND status IN ('queued', 'processing')
       RETURNING input_urls`,
      [
        input.meshyTaskId,
        input.status,
        Math.min(100, Math.max(0, Math.round(input.progress))),
        input.outputUrls ? JSON.stringify(input.outputUrls) : null,
        input.error ?? null,
      ],
    );
    if (input.status === "succeeded" || input.status === "failed") {
      const inputUrls = updated.rows.flatMap((row) => asStringArray(row.input_urls));
      if (inputUrls.length > 0) await deleteTemporaryBlobs(inputUrls);
    }
  } catch (error) {
    console.error("Could not persist generation job progress.", error);
  }
}
