import { describe, it, expect, vi } from "vitest";
import { LogLevel, log, getLogLevel } from "../src/logger.js";

describe("LogLevel enum", () => {
  it("has correct numeric values", () => {
    expect(LogLevel.ERROR).toBe(0);
    expect(LogLevel.WARN).toBe(1);
    expect(LogLevel.INFO).toBe(2);
    expect(LogLevel.DEBUG).toBe(3);
  });
});

describe("getLogLevel", () => {
  it("returns a valid LogLevel value", () => {
    const level = getLogLevel();
    expect(level).toBeGreaterThanOrEqual(LogLevel.ERROR);
    expect(level).toBeLessThanOrEqual(LogLevel.DEBUG);
  });
});

describe("log", () => {
  it("writes to stderr (console.error)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log(LogLevel.ERROR, "test error message");
    expect(spy).toHaveBeenCalled();
    const call = spy.mock.calls[0];
    expect(call[0]).toContain("[ERROR]");
    expect(call[0]).toContain("test error message");
    spy.mockRestore();
  });

  it("does not log messages above current level", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    // DEBUG (3) is above default INFO (2), so it should not log
    // unless LOG_LEVEL env var is set to 3
    const currentLevel = getLogLevel();
    if (currentLevel < LogLevel.DEBUG) {
      log(LogLevel.DEBUG, "debug message");
      expect(spy).not.toHaveBeenCalled();
    }
    spy.mockRestore();
  });

  it("includes prefix matching the log level", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log(LogLevel.ERROR, "some error");
    expect(spy.mock.calls[0][0]).toMatch(/\[ERROR\]/);
    spy.mockRestore();
  });
});
