/**
 * Shared helper functions for ADB operations.
 */

import { execFile, ExecFileOptionsWithStringEncoding } from "child_process";
import { promisify } from "util";
import { unlink } from "fs/promises";
import { join, basename } from "path";
import { tmpdir } from "os";
import { LogLevel, log } from "./logger.js";

const execFilePromise = promisify(execFile);

const DEFAULT_EXEC_OPTIONS: ExecFileOptionsWithStringEncoding = {
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
  timeout: 30_000,
};

type ExecResult = { stdout: string; stderr: string };

export async function runAdb(args: string[], options?: ExecFileOptionsWithStringEncoding): Promise<ExecResult> {
  const execOptions: ExecFileOptionsWithStringEncoding = {
    ...DEFAULT_EXEC_OPTIONS,
    ...(options ?? {}),
  };
  const adbBinary = process.env.ADB_PATH || "adb";
  return execFilePromise(adbBinary, args, execOptions) as Promise<ExecResult>;
}

/**
 * Executes an ADB command and handles errors consistently.
 *
 * Stderr handling: ADB routinely writes warnings and informational messages to
 * stderr even on success. We only treat stderr as an error when the command
 * itself produced no stdout AND stderr looks like an actual error (doesn't
 * match the known-benign patterns).
 */
const NON_ERROR_PATTERNS = [
  "Warning: Activity not started",
  "WARNING:",
  "Performing Streamed Install", // normal install progress
];

export async function executeAdbCommand(args: string[], errorMessage: string) {
  const commandString = ["adb", ...args].join(" ");
  try {
    log(LogLevel.DEBUG, `Executing command: ${commandString}`);
    const { stdout, stderr } = await runAdb(args);
    const stderrText = stderr.trim();

    if (stderrText) {
      const isBenign = NON_ERROR_PATTERNS.some((p) => stderrText.includes(p));

      if (isBenign) {
        log(LogLevel.WARN, `Command warning (not error): ${stderrText}`);
        return {
          content: [{
            type: "text" as const,
            text: stdout || stderrText.replace(/^Error: /, ""),
          }],
        };
      }

      // If we got useful stdout, treat stderr as a warning only
      if (stdout.trim()) {
        log(LogLevel.WARN, `Command produced stderr alongside stdout: ${stderrText}`);
      } else {
        log(LogLevel.ERROR, `Command error: ${stderrText}`);
        return {
          content: [{ type: "text" as const, text: `Error: ${stderrText}` }],
          isError: true,
        };
      }
    }

    const commandSummary = args[0] ? `${args[0]}` : commandString;
    log(LogLevel.INFO, `ADB command executed successfully: ${commandSummary}`);
    return {
      content: [{
        type: "text" as const,
        text: stdout || "Command executed successfully",
      }],
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(LogLevel.ERROR, `${errorMessage}: ${errorMsg}`);
    return {
      content: [{ type: "text" as const, text: `${errorMessage}: ${errorMsg}` }],
      isError: true,
    };
  }
}

export function createTempFilePath(prefix: string, filename: string): string {
  return join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${basename(filename)}`);
}

export async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
    log(LogLevel.DEBUG, `Cleaned up temp file: ${filePath}`);
  } catch {
    log(LogLevel.WARN, `Failed to clean up temp file ${filePath}`);
  }
}

export function buildDeviceArgs(device?: string): string[] {
  return device ? ["-s", device] : [];
}

/**
 * Generates a unique remote path on the device to avoid race conditions.
 */
export function uniqueRemotePath(filename: string): string {
  return `/data/local/tmp/adb-mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${filename}`;
}

/**
 * Splits a command string into arguments, respecting single/double quotes and escapes.
 */
export function splitCommandArguments(value: string): string[] {
  const args: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escapeNext = false;

  for (const char of value) {
    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escapeNext) {
    current += "\\";
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

// ========== send_text escaping ==========

/**
 * Sanitizes text for `adb shell input text`: expands tabs to spaces,
 * strips newlines (not supported by `input text`).
 */
export function sanitizeInputText(text: string): string {
  return text.replace(/\t/g, "    ").replace(/[\r\n]/g, "");
}

/**
 * Returns true when the string contains non-ASCII characters and should
 * be sent via the Unicode (single-quote) path.
 */
export function hasNonAscii(text: string): boolean {
  return /[^\x00-\x7F]/.test(text);
}

/**
 * Escapes text for the Unicode path of `adb shell input text`.
 * Wraps in single quotes; escapes %, \, and ' inside.
 */
export function escapeTextUnicode(sanitized: string): string {
  const escaped = sanitized
    .replace(/%/g, "%%")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "'\\''");
  return "'" + escaped + "'";
}

/**
 * Escapes text for the ASCII path of `adb shell input text`.
 * Spaces → %s, % → %%, shell metacharacters → backslash-escaped.
 */
export function escapeTextAscii(sanitized: string): string {
  let escaped = "";
  for (const ch of sanitized) {
    if (ch === " ") {
      escaped += "%s";
    } else if (ch === "%") {
      escaped += "%%";
    } else if ("&|;<>()$`\\!\"'~{}#*?".includes(ch)) {
      escaped += "\\" + ch;
    } else {
      escaped += ch;
    }
  }
  return escaped;
}
