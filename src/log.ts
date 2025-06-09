import notify from 'sd-notify';
import type { JournalFields } from 'systemd-journald';
import Journald from 'systemd-journald';
import type { Thrtime, TLogArgument, TLogArgumentDic } from './log.helper.js';
import { toSnakeCase } from './log.helper.js';

export const levelMap = {
  // level 0 – debug
  debug: 0,
  trace: 0,

  info: 1,
  information: 1,

  notice: 2,

  warning: 3,
  warn: 3,

  error: 4,
  err: 4,

  crit: 5,
  critical: 5,
  fatal: 5,
};

export const levelNames = {
  0: 'DEBUG',
  1: 'INFO',
  2: 'NOTICE',
  3: 'WARNING',
  4: 'ERROR',
  5: 'CRIT',
} as const;

export type TLovLevel = keyof typeof levelNames;
const journal = new Journald({ syslog_identifier: process.env.SYSLOG_IDENTIFIER || 'pw-stick-output' });
export let logLevel = (() => {
  let logLevel = process.env.SYSLOG_LEVEL?.toString().toLowerCase() || '';
  let n = +process.env.SYSLOG_LEVEL!;
  n = logLevel in levelMap ? levelMap[logLevel as keyof typeof levelMap] : Number.isNaN(n) ? 2 : n;
  return Math.max(0, Math.min(5, n)) as TLovLevel;
})();

export function log<T>(someToLog: TLogArgument<T>, level: TLovLevel = 0, hrtime: Thrtime | undefined = undefined) {
  level = Math.max(0, Math.min(5, level)) as TLovLevel;
  let msg = {} as TLogArgumentDic<T>;
  if (level < logLevel) return;
  if (typeof someToLog === 'string') {
    msg.msg = someToLog;
  }
  if (someToLog instanceof Error) {
    msg.error = someToLog;
  }
  if (!hrtime) {
    hrtime = process.hrtime();
  }
  let extraFieldsRaw = (hrtime ? { time_seconds: hrtime[0], time_nanoseconds: hrtime[1] } : {}) as Record<string, any>;

  // omit & sort keys
  if (!(someToLog instanceof Error) && typeof someToLog === 'object') {
    Object.keys(someToLog)
      .sort()
      .forEach((key) => {
        if (['msg', 'error'].includes(key)) {
          return;
        }
        const val = (someToLog as any)[key];
        if (typeof val === 'undefined' || val === null) {
          return;
        }
        extraFieldsRaw[toSnakeCase(key)] = val;
      });
  }
  let extraFields: JournalFields | undefined;
  extraFields = extraFieldsRaw;
  const message = msg.error || msg.msg || '<?>';
  if (level === 0) {
    journal.debug(message, extraFields);
  } else if (level === 1) {
    journal.info(message, extraFields);
  } else if (level === 2) {
    journal.notice(message, extraFields);
  } else if (level === 3) {
    journal.warning(message, extraFields);
  } else if (level === 4) {
    journal.err(message, extraFields);
  } else if (level === 5) {
    journal.crit(message, extraFields);
  }
  const statusLabel = levelNames[level];
  notify.sendStatus(`${statusLabel}: ${message}`);
}

log({ msg: `SYSLOG_LEVEL=${logLevel}`, extraArray: [0] }, 0, process.hrtime());
