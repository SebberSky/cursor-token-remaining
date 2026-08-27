declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean });
    prepare(sql: string): { get(...params: unknown[]): unknown };
    close(): void;
  }
}
