import { describe, it, expect } from "vitest";
import {
  splitCommandArguments,
  buildDeviceArgs,
  createTempFilePath,
  uniqueRemotePath,
  sanitizeInputText,
  hasNonAscii,
  escapeTextUnicode,
  escapeTextAscii,
} from "../src/helpers.js";

describe("splitCommandArguments", () => {
  it("splits simple space-separated args", () => {
    expect(splitCommandArguments("foo bar baz")).toEqual(["foo", "bar", "baz"]);
  });

  it("handles multiple spaces between args", () => {
    expect(splitCommandArguments("foo   bar")).toEqual(["foo", "bar"]);
  });

  it("handles empty string", () => {
    expect(splitCommandArguments("")).toEqual([]);
  });

  it("handles single arg with no spaces", () => {
    expect(splitCommandArguments("hello")).toEqual(["hello"]);
  });

  it("respects double quotes", () => {
    expect(splitCommandArguments('foo "bar baz" qux')).toEqual([
      "foo",
      "bar baz",
      "qux",
    ]);
  });

  it("respects single quotes", () => {
    expect(splitCommandArguments("foo 'bar baz' qux")).toEqual([
      "foo",
      "bar baz",
      "qux",
    ]);
  });

  it("handles escaped characters with backslash", () => {
    expect(splitCommandArguments("foo\\ bar baz")).toEqual(["foo\\ bar", "baz"]);
  });

  it("handles mixed quotes", () => {
    expect(splitCommandArguments(`"hello world" 'foo bar'`)).toEqual([
      "hello world",
      "foo bar",
    ]);
  });

  it("handles leading and trailing spaces", () => {
    expect(splitCommandArguments("  foo bar  ")).toEqual(["foo", "bar"]);
  });

  it("handles tabs as whitespace", () => {
    expect(splitCommandArguments("foo\tbar")).toEqual(["foo", "bar"]);
  });

  it("handles double quote inside single quotes", () => {
    expect(splitCommandArguments(`'he said "hi"'`)).toEqual([`he said "hi"`]);
  });

  it("handles single quote inside double quotes", () => {
    expect(splitCommandArguments(`"it's fine"`)).toEqual(["it's fine"]);
  });

  it("handles logcat-style filter expressions", () => {
    expect(splitCommandArguments("ActivityManager:I *:S")).toEqual([
      "ActivityManager:I",
      "*:S",
    ]);
  });

  it("handles am-style arguments with intent flags", () => {
    expect(
      splitCommandArguments("-a android.intent.action.VIEW -d http://example.com"),
    ).toEqual(["-a", "android.intent.action.VIEW", "-d", "http://example.com"]);
  });
});

describe("buildDeviceArgs", () => {
  it("returns empty array when no device specified", () => {
    expect(buildDeviceArgs()).toEqual([]);
    expect(buildDeviceArgs(undefined)).toEqual([]);
  });

  it("returns -s flag with device id", () => {
    expect(buildDeviceArgs("emulator-5554")).toEqual(["-s", "emulator-5554"]);
  });

  it("handles device id with special characters", () => {
    expect(buildDeviceArgs("192.168.1.1:5555")).toEqual([
      "-s",
      "192.168.1.1:5555",
    ]);
  });
});

describe("createTempFilePath", () => {
  it("creates path in system temp directory", () => {
    const path = createTempFilePath("adb-mcp", "test.xml");
    expect(path).toContain("adb-mcp");
    expect(path).toContain("test.xml");
  });

  it("generates unique paths on successive calls", () => {
    const path1 = createTempFilePath("adb-mcp", "file.png");
    const path2 = createTempFilePath("adb-mcp", "file.png");
    expect(path1).not.toBe(path2);
  });

  it("uses only the basename of the filename", () => {
    const path = createTempFilePath("prefix", "/some/nested/file.txt");
    expect(path).toContain("file.txt");
    expect(path).not.toContain("/some/nested");
  });
});

describe("uniqueRemotePath", () => {
  it("creates path under /data/local/tmp", () => {
    const path = uniqueRemotePath("dump.xml");
    expect(path).toMatch(/^\/data\/local\/tmp\/adb-mcp-/);
    expect(path).toContain("dump.xml");
  });

  it("generates unique paths", () => {
    const path1 = uniqueRemotePath("file.txt");
    const path2 = uniqueRemotePath("file.txt");
    expect(path1).not.toBe(path2);
  });
});

// ========== send_text escaping ==========

describe("sanitizeInputText", () => {
  it("expands tabs to 4 spaces", () => {
    expect(sanitizeInputText("a\tb")).toBe("a    b");
  });

  it("strips newlines (\\n and \\r\\n)", () => {
    expect(sanitizeInputText("line1\nline2")).toBe("line1line2");
    expect(sanitizeInputText("line1\r\nline2")).toBe("line1line2");
  });

  it("strips \\r alone", () => {
    expect(sanitizeInputText("a\rb")).toBe("ab");
  });

  it("handles mixed tabs and newlines", () => {
    expect(sanitizeInputText("\thello\nworld\t")).toBe("    helloworld    ");
  });

  it("returns plain text unchanged", () => {
    expect(sanitizeInputText("hello world")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(sanitizeInputText("")).toBe("");
  });
});

describe("hasNonAscii", () => {
  it("returns false for plain ASCII", () => {
    expect(hasNonAscii("hello 123 !@#")).toBe(false);
  });

  it("returns true for Czech diacritics", () => {
    expect(hasNonAscii("příliš žluťoučký")).toBe(true);
  });

  it("returns true for emoji", () => {
    expect(hasNonAscii("hello 🌍")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(hasNonAscii("")).toBe(false);
  });
});

describe("escapeTextUnicode", () => {
  it("wraps text in single quotes", () => {
    expect(escapeTextUnicode("hello")).toBe("'hello'");
  });

  it("escapes percent to %%", () => {
    expect(escapeTextUnicode("100%")).toBe("'100%%'");
  });

  it("escapes backslash to \\\\", () => {
    expect(escapeTextUnicode("a\\b")).toBe("'a\\\\b'");
  });

  it("escapes single quote via shell concatenation", () => {
    expect(escapeTextUnicode("it's")).toBe("'it'\\''s'");
  });

  it("escapes all special chars together", () => {
    expect(escapeTextUnicode("100%\\it's")).toBe("'100%%\\\\it'\\''s'");
  });

  it("handles empty string", () => {
    expect(escapeTextUnicode("")).toBe("''");
  });

  it("preserves diacritics without escaping", () => {
    expect(escapeTextUnicode("ěščřžýáíé")).toBe("'ěščřžýáíé'");
  });

  it("preserves spaces inside quotes", () => {
    expect(escapeTextUnicode("hello world")).toBe("'hello world'");
  });
});

describe("escapeTextAscii", () => {
  it("escapes spaces to %s", () => {
    expect(escapeTextAscii("hello world")).toBe("hello%sworld");
  });

  it("escapes percent to %%", () => {
    expect(escapeTextAscii("100%")).toBe("100%%");
  });

  it("escapes shell metacharacters with backslash", () => {
    expect(escapeTextAscii("a&b")).toBe("a\\&b");
    expect(escapeTextAscii("a|b")).toBe("a\\|b");
    expect(escapeTextAscii("a;b")).toBe("a\\;b");
    expect(escapeTextAscii("a<b>c")).toBe("a\\<b\\>c");
    expect(escapeTextAscii("$(cmd)")).toBe("\\$\\(cmd\\)");
    expect(escapeTextAscii("`cmd`")).toBe("\\`cmd\\`");
    expect(escapeTextAscii("a\\b")).toBe("a\\\\b");
    expect(escapeTextAscii('a"b')).toBe('a\\"b');
    expect(escapeTextAscii("a'b")).toBe("a\\'b");
    expect(escapeTextAscii("a~b")).toBe("a\\~b");
    expect(escapeTextAscii("a{b}")).toBe("a\\{b\\}");
    expect(escapeTextAscii("a#b")).toBe("a\\#b");
    expect(escapeTextAscii("a*b")).toBe("a\\*b");
    expect(escapeTextAscii("a?b")).toBe("a\\?b");
    expect(escapeTextAscii("a!b")).toBe("a\\!b");
  });

  it("leaves plain alphanumeric text unchanged", () => {
    expect(escapeTextAscii("hello123")).toBe("hello123");
  });

  it("handles empty string", () => {
    expect(escapeTextAscii("")).toBe("");
  });

  it("handles multiple spaces", () => {
    expect(escapeTextAscii("a b c")).toBe("a%sb%sc");
  });

  it("handles combined special characters", () => {
    expect(escapeTextAscii("100% done & ready!")).toBe("100%%%sdone%s\\&%sready\\!");
  });
});
