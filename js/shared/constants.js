/**
 * Shared constants used across service-worker and UI bundles.
 * @module shared/constants
 */

// ── Interceptor ───────────────────────────────────────────────────

export const BOGUS_HASH_SEED = '1234567890';
export const BASE64_CHUNK_SIZE = 8192;
export const DEFAULT_OPERATION_NAME = 'Anonymous Query';

// ── Hash Registry / Passive Mode ──────────────────────────────────

export const HASH_REGISTRY_STORAGE_KEY = 'apqHashRegistry';
export const PASSIVE_MODE_STORAGE_KEY = 'apqPassiveMode';

// ── Schema ────────────────────────────────────────────────────────

export const SCHEMA_STORAGE_KEY = 'apqSchemaUrl';
