declare module 'systemd-journald' {
  /**
   * Primitive values supported as journal fields.
   * You can add other types if the native module accepts them.
   */
  export type Stringable = string | number | boolean | bigint | Date;

  /**
   * A map of key→value pairs to attach to the journal entry.
   */
  export interface JournalFields {
    [key: string]: Stringable;
  }

  /**
   * Journald client for sending structured logs to systemd-journald.
   */
  export default class Journald {
    /**
     * Create a new Journald logger.
     * @param options - Default fields (e.g. syslog_identifier) to include on every message.
     */
    constructor(options?: JournalFields);

    /**
     * Log a debug-level message.
     */
    debug(message: Stringable, fields?: JournalFields): void;

    /**
     * Log an info-level message.
     */
    info(message: Stringable, fields?: JournalFields): void;

    /**
     * Log a notice-level message.
     */
    notice(message: Stringable, fields?: JournalFields): void;

    /**
     * Log a warning-level message.
     */
    warning(message: Stringable, fields?: JournalFields): void;

    /**
     * Log an error-level message.
     */
    err(message: Stringable, fields?: JournalFields): void;

    /**
     * Log a critical-level message.
     */
    crit(message: Stringable, fields?: JournalFields): void;
  }
}
