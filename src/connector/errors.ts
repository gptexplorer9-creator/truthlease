export class ConnectorError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}

export function asConnectorError(error: unknown): ConnectorError {
  if (error instanceof ConnectorError) return error;
  return new ConnectorError('transport_error', error instanceof Error ? error.message : 'Unknown connector failure', true, error);
}

