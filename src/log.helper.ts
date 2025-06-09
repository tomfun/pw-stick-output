import type { Stringable } from 'systemd-journald';

export type Thrtime = [number, number];
type LogDic<T> = T extends Stringable
  ? T
  : T extends any[]
    ? { [K in keyof T]: Log<T[K]> }
    : T extends object
      ? { [K in keyof T]: Log<T[K]> }
      : never;
export type Log<T> = null | undefined | LogDic<T>;
export type TLogArgumentDic<T> = ({ error?: Error; msg: string } & Log<T>) | (Log<T> & Record<string | number, any>);
export type TLogArgument<T> = TLogArgumentDic<Exclude<T, 'msg' | 'error'>> | Error | string;

/**
 * Runtime snake_case converter (handles camelCase, PascalCase, spaces, and dashes).
 */
export function toSnakeCase(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}
/**
 * Convert a camelCase/PascalCase/kebab-case string S into snake_case.
 */
type SnakeCase<S extends string> = S extends `${infer Head}${infer Tail}`
  ? Tail extends Uncapitalize<Tail>
    ? `${Lowercase<Head>}${SnakeCase<Tail>}`
    : `${Lowercase<Head>}_${SnakeCase<Tail>}`
  : S;
