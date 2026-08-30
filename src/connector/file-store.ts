import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { ConnectorError } from './errors.js';
import type { ConnectorCursor, ConnectorState, ConnectorStateStore } from './types.js';

interface FileConnectorStateStoreOptions {
  path: string;
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function normalizeCursor(value: unknown): ConnectorCursor | null {
  if (value === null) return null;
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (!isString(candidate.eventId)) return null;
  if (!('sequence' in candidate)) return { eventId: candidate.eventId };
  if (!Number.isSafeInteger(candidate.sequence) || typeof candidate.sequence !== 'number') return null;
  return { eventId: candidate.eventId, sequence: candidate.sequence };
}

function normalizeEventIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const values: string[] = [];
  for (const item of value) {
    if (!isString(item)) return undefined;
    values.push(item);
  }
  return values;
}

function isConnectorState(value: unknown): value is ConnectorState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const cursor = normalizeCursor(candidate.cursor ?? null);
  if (candidate.cursor !== null && candidate.cursor !== undefined && cursor === null) return false;
  if (!isString(candidate.updatedAt)) return false;
  if (candidate.lastBatchId !== undefined && !isString(candidate.lastBatchId)) return false;
  if (candidate.pendingBatchId !== undefined && !isString(candidate.pendingBatchId)) return false;
  if (candidate.pendingEventIds !== undefined && normalizeEventIds(candidate.pendingEventIds) === undefined) return false;
  return true;
}

function normalizeState(value: unknown): ConnectorState {
  if (!isConnectorState(value)) {
    throw new ConnectorError('invalid_state_store', 'Connector state file content is invalid.', false);
  }
  return {
    cursor: normalizeCursor(value.cursor ?? null),
    lastBatchId: isString(value.lastBatchId) ? value.lastBatchId : undefined,
    pendingBatchId: isString(value.pendingBatchId) ? value.pendingBatchId : undefined,
    pendingEventIds: normalizeEventIds(value.pendingEventIds),
    updatedAt: value.updatedAt,
  };
}

export class FileConnectorStateStore implements ConnectorStateStore {
  private readonly path: string;

  constructor(options: FileConnectorStateStoreOptions) {
    this.path = options.path;
    if (!isString(this.path)) {
      throw new ConnectorError('invalid_state_store', 'Connector state path is required.', false);
    }
  }

  async load() {
    try {
      const raw = await readFile(this.path, 'utf8');
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError('invalid_state_store', `Failed to load connector state from ${this.path}`, true, error);
    }
  }

  async save(state: ConnectorState) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.path);
  }
}
