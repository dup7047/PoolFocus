declare module "node:http" {
  export interface IncomingMessage extends AsyncIterable<unknown> {
    method?: string;
    url?: string;
  }

  export interface ServerResponse {
    writeHead(statusCode: number, headers?: Record<string, string>): void;
    end(chunk?: string): void;
  }

  export function createServer(
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  ): {
    listen(port: number, callback?: () => void): void;
  };

  const http: {
    createServer: typeof createServer;
  };

  export default http;
}

declare module "node:crypto" {
  export function randomUUID(): string;
}

declare module "node:assert/strict" {
  interface Assert {
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
  }

  const assert: Assert;
  export default assert;
}

declare class Buffer extends Uint8Array {
  static isBuffer(value: unknown): value is Buffer;
  static from(value: unknown): Buffer;
  static concat(chunks: readonly Buffer[]): Buffer;
  toString(encoding?: string): string;
}

declare const console: {
  log(message?: unknown, ...optionalParams: unknown[]): void;
};
