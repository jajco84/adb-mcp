/**
 * Simple logging utility with levels.
 *
 * All logs are sent to stderr (console.error) to avoid interfering with
 * the JSON communication on stdout between the MCP client and server.
 */

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3
}

const parsedLevel = process.env.LOG_LEVEL ? parseInt(process.env.LOG_LEVEL, 10) : LogLevel.INFO;
const LOG_LEVEL = Number.isNaN(parsedLevel) || parsedLevel < LogLevel.ERROR || parsedLevel > LogLevel.DEBUG
  ? LogLevel.INFO
  : parsedLevel;

export function log(level: LogLevel, message: string, ...args: unknown[]): void {
  if (level <= LOG_LEVEL) {
    const prefix = LogLevel[level] || "UNKNOWN";
    console.error(`[${prefix}] ${message}`, ...args);
  }
}

export function getLogLevel(): LogLevel {
  return LOG_LEVEL;
}
