import type { ConnectorState, ConnectorStateStore } from './types.js';

export class MemoryConnectorStateStore implements ConnectorStateStore {
  private state: ConnectorState | null = null;
  async load() { return this.state ? structuredClone(this.state) : null; }
  async save(state: ConnectorState) { this.state = structuredClone(state); }
}

