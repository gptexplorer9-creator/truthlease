import { describe, expect, it } from 'vitest';

import { HttpTruthLeaseIngestionClient } from '../src/connector/http-client.js';

describe('generic connector HTTP client', () => {
  it('rejects bearer authorization over remote plain HTTP before fetch', () => {
    expect(() => new HttpTruthLeaseIngestionClient({
      endpoint: 'http://truthlease.example/api/events',
      authorization: 'Bearer secret',
    })).toThrow(/non-loopback plain HTTP/);
  });
});
