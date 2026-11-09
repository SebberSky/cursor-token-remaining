declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean });
    prepare(sql: string): {
      get(...params: unknown[]): unknown;
      run(...params: unknown[]): { changes?: number };
    };
    exec(sql: string): void;
    close(): void;
  }
}
