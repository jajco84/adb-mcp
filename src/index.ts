#!/usr/bin/env node

/**
 * ADB MCP Server
 * --------------
 *
 * Common tools:
 * - adb-devices: List connected devices
 * - inspect-ui: THE MAIN TOOL to check which app is currently on screen
 * - dump-image: Take a screenshot of the current screen
 * - adb-shell: Run shell commands on the device
 *
 * Logging:
 * - Default log level is INFO (shows important operations)
 * - For detailed logs, run with: LOG_LEVEL=3 npx adb-mcp
 * - Log levels: 0=ERROR, 1=WARN, 2=INFO, 3=DEBUG
 */

import { z } from "zod";
import { readFile, writeFile } from "fs/promises";
import { basename, join, dirname } from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { LogLevel, log, getLogLevel } from "./logger.js";
import {
  runAdb,
  executeAdbCommand,
  buildDeviceArgs,
  createTempFilePath,
  cleanupTempFile,
  splitCommandArguments,
  sanitizeInputText,
  hasNonAscii,
  escapeTextUnicode,
  escapeTextAscii,
} from "./helpers.js";
import {
  dumpUiHierarchyXml,
  parseUiHierarchy,
  takeScreenshotBuffer,
  extractInteractiveElements,
  generateAnnotationSvg,
  filterXmlAttributes,
  ANNOTATION_PADDING,
} from "./ui-analysis.js";
import {
  AdbDevicesSchema,
  AdbShellSchema,
  AdbInstallSchema,
  AdbLogcatSchema,
  AdbPullSchema,
  AdbPushSchema,
  AdbScreenshotSchema,
  AdbUidumpSchema,
  TapScreenSchema,
  SwipeScreenSchema,
  SendTextSchema,
  SystemActionSchema,
  AdbActivityManagerSchema,
  AdbPackageManagerSchema,
  KeyEventSchema,
  GetInteractiveElementsSchema,
  AnnotatedScreenshotSchema,
  type RequestHandlerExtra,
} from "./types.js";

// ========== Read version from package.json ==========

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function readPackageVersion(): Promise<string> {
  try {
    const pkgPath = join(__dirname, "..", "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// ========== Tool Descriptions ==========

const ADB_DEVICES_TOOL_DESCRIPTION =
  "Lists all connected Android devices and emulators with their status and details. " +
  "Use this tool to identify available devices for interaction, verify device connections, " +
  "and obtain device identifiers needed for other ADB commands. " +
  "Returns a table of device IDs with connection states (device, offline, unauthorized, etc.). " +
  "Useful before running any device-specific commands to ensure the target device is connected.";

const INSPECT_UI_TOOL_DESCRIPTION =
  "Captures the complete UI hierarchy of the current screen as an XML document. " +
  "This provides structured XML data that can be parsed to identify UI elements and their properties. " +
  "Essential for UI automation, determining current app state, and identifying interactive elements. " +
  "Returns the UI structure including all elements, their IDs, text values, bounds, and clickable states. " +
  "This is significantly more useful than screenshots for AI processing and automation tasks.";

const ADB_SHELL_TOOL_DESCRIPTION =
  "Executes a shell command on a connected Android device or emulator. " +
  "Use this for running Android system commands, managing files and permissions, " +
  "controlling device settings, or interacting with Android components. " +
  "Supports all standard shell commands available on Android (ls, pm, am, settings, etc.). " +
  "Specify a device ID to target a specific device when multiple devices are connected.";

const ADB_INSTALL_TOOL_DESCRIPTION =
  "Installs an Android application (APK) on a connected device or emulator. " +
  "Use this for deploying applications, testing new builds, or updating existing apps. " +
  "Provide the local path to the APK file for installation. " +
  "Automatically handles the installation process, including replacing existing versions. " +
  "Specify a device ID when working with multiple connected devices.";

const ADB_LOGCAT_TOOL_DESCRIPTION =
  "Retrieves Android system and application logs from a connected device. " +
  "Ideal for debugging app behavior, monitoring system events, and identifying errors. " +
  "Supports filtering by log tags or expressions to narrow down relevant information. " +
  "Results can be limited to a specific number of lines, making it useful for both brief checks and detailed analysis. " +
  "Use when troubleshooting crashes, unexpected behavior, or performance issues.";

const ADB_PULL_TOOL_DESCRIPTION =
  "Transfers a file from a connected Android device to the server. " +
  "Use this to retrieve app data files, logs, configurations, or any accessible file from the device. " +
  "The file content can be returned as base64-encoded data or as a success message. " +
  "Requires the full path to the file on the device. " +
  "Useful for data extraction, log collection, and backing up device files.";

const ADB_PUSH_TOOL_DESCRIPTION =
  "Transfers a file from the server to a connected Android device. " +
  "Useful for uploading test data, configuration files, media content, or any file needed on the device. " +
  "The file must be provided as base64-encoded content. " +
  "Requires specifying the full destination path on the device where the file should be placed. " +
  "Use this when setting up test environments, restoring backups, or modifying device files.";

const ADB_DUMP_IMAGE_TOOL_DESCRIPTION =
  "Captures the current screen of a connected Android device and returns it as a PNG image. " +
  "The screenshot shows exactly what appears on the device screen at the moment of capture. " +
  "By default the image is resized to 40% (scaleFactor=0.4) to reduce size. Set scaleFactor=1.0 for full resolution. " +
  "Supports an optional scaleFactor parameter (0.1–1.0). " +
  "Use when you need to visually verify UI elements. " +
  "NOTE: Coordinates from a scaled screenshot must not be used directly for tap/swipe without conversion to native device pixels. " +
  "For programmatic element coordinates, use get_interactive_elements (or inspect_ui when full XML is needed).";

const TAP_SCREEN_TOOL_DESCRIPTION =
  "Taps on the screen of the connected Android device at the given coordinates. " +
  "Useful for clicking buttons, selecting items, or giving focus to input fields. " +
  "Use inspect_ui to find the bounds of UI elements and calculate tap coordinates.";

const SWIPE_SCREEN_TOOL_DESCRIPTION =
  "Swipes on the screen of the connected Android device from a starting point to an ending point. " +
  "Useful for scrolling, dismissing notifications, or navigating between screens. " +
  "Optionally specify duration in milliseconds to control swipe speed.";

const SEND_TEXT_TOOL_DESCRIPTION =
  "Sends the given text to the connected Android device, as if it were typed on a keyboard. " +
  "The target input field must have focus first — use tap_screen to tap on an input field before sending text. " +
  "Special characters and spaces are escaped automatically.";

const KEY_EVENT_TOOL_DESCRIPTION =
  "Sends an arbitrary Android key event to the connected device. " +
  "Use this for keys not covered by perform_system_action, such as ENTER, DELETE, VOLUME_UP, " +
  "TAB, DPAD navigation, MEDIA_PLAY_PAUSE, POWER, etc. " +
  "Accepts any valid Android KEYCODE_* constant (e.g. 'KEYCODE_ENTER'). " +
  "Supports long-press via the longpress parameter.";

const SYSTEM_ACTION_TOOL_DESCRIPTION =
  "Performs a system action on the connected Android device. " +
  "Supported actions: BACK (press system back button), HOME (go to home screen), " +
  "RECENT_APPS (open recent apps view).";

const ADB_ACTIVITY_MANAGER_TOOL_DESCRIPTION =
  "Executes Activity Manager (am) commands on a connected Android device. " +
  "Supports starting activities, broadcasting intents, force-stopping packages, and other 'am' subcommands. " +
  "Specify the subcommand (e.g. 'start', 'broadcast', 'force-stop') and arguments as you would in adb shell am. " +
  "Example: amCommand='start', amArgs='-a android.intent.action.VIEW -d http://www.example.com'";

const ADB_PACKAGE_MANAGER_TOOL_DESCRIPTION =
  "Executes Package Manager (pm) commands on a connected Android device. " +
  "Supports listing packages, installing/uninstalling apps, managing permissions, and other 'pm' subcommands. " +
  "Common commands include: 'list packages', 'install', 'uninstall', 'grant', 'revoke', 'clear', 'enable', 'disable'. " +
  "Example: pmCommand='list', pmArgs='packages -3' (lists third-party packages) or pmCommand='grant', pmArgs='com.example.app android.permission.CAMERA'";

const GET_INTERACTIVE_ELEMENTS_DESCRIPTION =
  "Parses the current screen's UI hierarchy and returns a structured JSON array of all interactive elements. " +
  "Each element includes: name (text label), className, center coordinates {x, y}, and boundingBox {x1, y1, x2, y2}. " +
  "Interactive elements are those that are clickable, focusable, checkable, scrollable, or belong to known input classes. " +
  "Use this instead of inspect_ui when you need structured, actionable data about UI elements.";

const ANNOTATED_SCREENSHOT_DESCRIPTION =
  "Takes a screenshot and overlays numbered bounding boxes on all interactive UI elements. " +
  "Each interactive element gets a colored rectangle with an index label, making it easy to identify " +
  "and reference elements visually. Returns the annotated image as base64-encoded PNG followed by " +
  "a JSON index mapping each label number to the element's name and center coordinates. " +
  "Use scaleFactor to control image size (0.1–1.0, default 0.7 = 70%).";

// ========== Server Setup ==========

async function runServer(): Promise<void> {
  const version = await readPackageVersion();

  const server = new McpServer({
    name: "ADB MCP Server",
    version,
    namespace: "adb",
  });

  // ========== Resources ==========

  server.resource(
    "adb-version",
    "adb://version",
    async (uri: URL) => {
      try {
        const { stdout } = await runAdb(["version"]);
        return { contents: [{ uri: uri.href, text: stdout }] };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log(LogLevel.ERROR, `Error retrieving ADB version: ${errorMsg}`);
        return {
          contents: [{ uri: uri.href, text: `Error retrieving ADB version: ${errorMsg}` }],
          isError: true,
        };
      }
    },
  );

  server.resource(
    "device-list",
    "adb://devices",
    async (uri: URL) => {
      try {
        const { stdout } = await runAdb(["devices", "-l"]);
        return { contents: [{ uri: uri.href, text: stdout }] };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log(LogLevel.ERROR, `Error retrieving device list: ${errorMsg}`);
        return {
          contents: [{ uri: uri.href, text: `Error retrieving device list: ${errorMsg}` }],
          isError: true,
        };
      }
    },
  );

  // ========== Tools ==========

  // FIX #4: adb_devices now uses -l for detailed output
  server.tool(
    "adb_devices",
    ADB_DEVICES_TOOL_DESCRIPTION,
    AdbDevicesSchema.shape,
    async (_args: Record<string, never>, _extra: RequestHandlerExtra) => {
      log(LogLevel.INFO, "Listing connected devices");
      return executeAdbCommand(["devices", "-l"], "Error executing adb devices");
    },
  );

  server.tool(
    "inspect_ui",
    INSPECT_UI_TOOL_DESCRIPTION,
    AdbUidumpSchema.shape,
    async (args: z.infer<typeof AdbUidumpSchema>, _extra: RequestHandlerExtra) => {
      log(LogLevel.INFO, "Dumping UI hierarchy");

      try {
        let xmlContent = await dumpUiHierarchyXml(args.device);

        // FIX #2: Only return base64 when explicitly requested (default is false)
        if (args.asBase64 === true) {
          const base64Xml = Buffer.from(xmlContent, "utf8").toString("base64");
          log(LogLevel.INFO, "UI hierarchy dumped successfully as base64");
          return {
            content: [{ type: "text" as const, text: base64Xml }],
          };
        }

        // Filter attributes if returnedAttributes is specified
        if (args.returnedAttributes) {
          const possibleAttributes = new Set([
            "index", "text", "resource-id", "class", "package", "content-desc",
            "checkable", "checked", "clickable", "enabled", "focusable", "focused",
            "scrollable", "long-clickable", "password", "selected", "bounds",
            "drawing-order", "hint",
          ]);

          const attributesToKeep = args.returnedAttributes.split(",").map((a: string) => a.trim());
          const invalidAttrs = attributesToKeep.filter((a: string) => !possibleAttributes.has(a));
          if (invalidAttrs.length > 0) {
            return {
              content: [{ type: "text" as const, text: `Invalid attribute(s): ${invalidAttrs.join(", ")}. Possible: ${[...possibleAttributes].join(", ")}` }],
              isError: true,
            };
          }

          const keepSet = new Set(attributesToKeep);
          xmlContent = filterXmlAttributes(xmlContent, keepSet);
        }

        log(LogLevel.INFO, "UI hierarchy dumped successfully as plain text");
        return {
          content: [{ type: "text" as const, text: xmlContent }],
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log(LogLevel.ERROR, `Error dumping UI hierarchy: ${errorMsg}`);
        return {
          content: [{ type: "text" as const, text: `Error dumping UI hierarchy: ${errorMsg}` }],
          isError: true,
        };
      }
    },
  );

  // FIX #1: adb_shell now properly splits command into arguments
  server.tool(
    "adb_shell",
    ADB_SHELL_TOOL_DESCRIPTION,
    AdbShellSchema.shape,
    async (args: z.infer<typeof AdbShellSchema>, _extra: RequestHandlerExtra) => {
      log(LogLevel.INFO, `Executing shell command: ${args.command}`);

      const deviceArgs = buildDeviceArgs(args.device);
      const trimmedCommand = args.command.trim();
      if (!trimmedCommand) {
        const message = "Shell command must not be empty";
        log(LogLevel.ERROR, message);
        return {
          content: [{ type: "text" as const, text: message }],
          isError: true,
        };
      }

      // Pass the command as a single string via "sh -c" so shell operators
      // (pipes, &&, ;, etc.) work correctly, while execFile prevents host injection.
      return executeAdbCommand(
        [...deviceArgs, "shell", "sh", "-c", trimmedCommand],
        "Error executing shell command",
      );
    },
  );

  server.tool(
    "adb_install",
    ADB_INSTALL_TOOL_DESCRIPTION,
    AdbInstallSchema.shape,
    async (args: z.infer<typeof AdbInstallSchema>, _extra: RequestHandlerExtra) => {
      log(LogLevel.INFO, `Installing APK file from path: ${args.apkPath}`);

      try {
        const deviceArgs = buildDeviceArgs(args.device);
        const apkPath = args.apkPath.trim();
        if (!apkPath) {
          throw new Error("APK path must not be empty");
        }

        const result = await executeAdbCommand([...deviceArgs, "install", "-r", apkPath], "Error installing APK");
        if (!result.isError) {
          log(LogLevel.INFO, "APK installed successfully");
        }
        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log(LogLevel.ERROR, `Error installing APK: ${errorMsg}`);
        return {
          content: [{ type: "text" as const, text: `Error installing APK: ${errorMsg}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "adb_logcat",
    ADB_LOGCAT_TOOL_DESCRIPTION,
    AdbLogcatSchema.shape,
    async (args: z.infer<typeof AdbLogcatSchema>, _extra: RequestHandlerExtra) => {
      const lines = args.lines || 50;
      const filterExpr = args.filter ? args.filter : "";
      log(LogLevel.INFO, `Reading logcat (${lines} lines, filter: ${filterExpr || "none"}, app: ${args.appPackage || "none"}, level: ${args.logLevel || "none"})`);

      const deviceArgs = buildDeviceArgs(args.device);

      try {
        let pid: string | undefined;
        if (args.appPackage) {
          const pidResult = await runAdb([...deviceArgs, "shell", "pidof", "-s", args.appPackage]);
          pid = pidResult.stdout.trim();
          if (!pid) {
            return {
              content: [{ type: "text" as const, text: `App with package '${args.appPackage}' not running or not found.` }],
              isError: true,
            };
          }
          log(LogLevel.DEBUG, `Resolved PID for ${args.appPackage}: ${pid}`);
        }

        const logLevelMap: Record<string, string> = { VERBOSE: "V", DEBUG: "D", INFO: "I", WARNING: "W", ERROR: "E" };
        const logcatArgs = [...deviceArgs, "logcat", "-d", "-b", "default"];

        if (pid) {
          logcatArgs.push("--pid", pid);
        }

        if (args.logLevel && logLevelMap[args.logLevel]) {
          logcatArgs.push(`*:${logLevelMap[args.logLevel]}`);
        }

        const filterArgs = filterExpr ? splitCommandArguments(filterExpr) : [];
        logcatArgs.push(...filterArgs);

        const { stdout, stderr } = await runAdb(logcatArgs);
        if (stderr) {
          log(LogLevel.WARN, `logcat returned stderr: ${stderr}`);
        }

        const logLines = stdout.split(/\r?\n/);
        const limitedLines = lines > 0 ? logLines.slice(-lines) : logLines;
        const text = limitedLines.join("\n");

        return {
          content: [{ type: "text" as const, text: text || "No log entries found matching the criteria." }],
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log(LogLevel.ERROR, `Error reading logcat: ${errorMsg}`);
        return {
          content: [{ type: "text" as const, text: `Error reading logcat: ${errorMsg}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "adb_pull",
    ADB_PULL_TOOL_DESCRIPTION,
    AdbPullSchema.shape,
    async (args: z.infer<typeof AdbPullSchema>, _extra: RequestHandlerExtra) => {
      log(LogLevel.INFO, `Pulling file from device: ${args.remotePath}`);

      const deviceArgs = buildDeviceArgs(args.device);
      const tempFilePath = createTempFilePath("adb-mcp", basename(args.remotePath));

      try {
        const remotePath = args.remotePath.trim();
        if (!remotePath) {
          throw new Error("Remote path must not be empty");
        }

        const { stderr } = await runAdb([...deviceArgs, "pull", remotePath, tempFilePath]);
        if (stderr) {
          log(LogLevel.WARN, `adb pull reported stderr: ${stderr}`);
        }

        const fileData = await readFile(tempFilePath);
        if (args.asBase64 === true) {
          const base64Data = fileData.toString("base64");
          log(LogLevel.INFO, `File pulled from device successfully: ${remotePath}`);
          return {
            content: [{ type: "text" as const, text: base64Data }],
          };
        } else {
          let fileContent: string;
          try {
            fileContent = new TextDecoder("utf8", { fatal: true }).decode(fileData);
          } catch {
            return {
              content: [{
                type: "text" as const,
                text: "Pulled file is not valid UTF-8 text. Retry with asBase64=true to safely retrieve binary data.",
              }],
              isError: true,
            };
          }
          log(LogLevel.INFO, `File pulled from device successfully: ${remotePath}`);
          return {
            content: [{ type: "text" as const, text: fileContent }],
          };
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log(LogLevel.ERROR, `Error pulling file: ${errorMsg}`);
        return {
          content: [{ type: "text" as const, text: `Error pulling file: ${errorMsg}` }],
          isError: true,
        };
      } finally {
        await cleanupTempFile(tempFilePath);
      }
    },
  );

  server.tool(
    "adb_push",
    ADB_PUSH_TOOL_DESCRIPTION,
    AdbPushSchema.shape,
    async (args: z.infer<typeof AdbPushSchema>, _extra: RequestHandlerExtra) => {
      log(LogLevel.INFO, `Pushing file to device: ${args.remotePath}`);

      const deviceArgs = buildDeviceArgs(args.device);

      const remotePath = args.remotePath.trim();
      if (!remotePath) {
        return {
          content: [{ type: "text" as const, text: "Remote path must not be empty" }],
          isError: true,
        };
      }

      const tempFilePath = createTempFilePath("adb-mcp", basename(args.remotePath));

      try {
        if (!args.fileBase64 || !/^[A-Za-z0-9+/\r\n]+=*$/.test(args.fileBase64.replace(/\s/g, ""))) {
          return {
            content: [{ type: "text" as const, text: "Invalid base64 content provided" }],
            isError: true,
          };
        }
        const fileData = Buffer.from(args.fileBase64, "base64");
        if (fileData.length === 0) {
          return {
            content: [{ type: "text" as const, text: "Base64 content decoded to empty file" }],
            isError: true,
          };
        }
        await writeFile(tempFilePath, fileData);

        const result = await executeAdbCommand([...deviceArgs, "push", tempFilePath, remotePath], "Error pushing file");
        if (!result.isError) {
          log(LogLevel.INFO, `File pushed to device successfully: ${remotePath}`);
        }
        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log(LogLevel.ERROR, `Error pushing file: ${errorMsg}`);
        return {
          content: [{ type: "text" as const, text: `Error pushing file: ${errorMsg}` }],
          isError: true,
        };
      } finally {
        await cleanupTempFile(tempFilePath);
      }
    },
  );

  server.tool(
    "dump_image",
    ADB_DUMP_IMAGE_TOOL_DESCRIPTION,
    AdbScreenshotSchema.shape,
    async (args: z.infer<typeof AdbScreenshotSchema>, _extra: RequestHandlerExtra) => {
      log(LogLevel.INFO, "Taking device screenshot");
      const scaleFactor = args.scaleFactor ?? 0.4;

      try {
        const screenshot = await takeScreenshotBuffer(args.device, scaleFactor);
        const base64Image = screenshot.buffer.toString("base64");
        log(LogLevel.INFO, `Screenshot captured (scale: ${scaleFactor})`);
        return {
          content: [{
            type: "image" as const,
            data: base64Image,
            mimeType: "image/png",
          }],
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log(LogLevel.ERROR, `Error taking screenshot: ${errorMsg}`);
        return {
          content: [{ type: "text" as const, text: `Error taking screenshot: ${errorMsg}` }],
          isError: true,
        };
      }
    },
  );

  // ===== Input Interaction Tools =====

  server.tool(
    "tap_screen",
    TAP_SCREEN_TOOL_DESCRIPTION,
    TapScreenSchema.shape,
    async (args: z.infer<typeof TapScreenSchema>, _extra: RequestHandlerExtra) => {
      log(LogLevel.INFO, `Tapping screen at (${args.x}, ${args.y})`);
      const deviceArgs = buildDeviceArgs(args.device);
      return executeAdbCommand(
        [...deviceArgs, "shell", "input", "tap", String(args.x), String(args.y)],
        "Error tapping on screen",
      );
    },
  );

  server.tool(
    "swipe_screen",
    SWIPE_SCREEN_TOOL_DESCRIPTION,
    SwipeScreenSchema.shape,
    async (args: z.infer<typeof SwipeScreenSchema>, _extra: RequestHandlerExtra) => {
      log(LogLevel.INFO, `Swiping from (${args.x1}, ${args.y1}) to (${args.x2}, ${args.y2})`);
      const deviceArgs = buildDeviceArgs(args.device);
      const duration = args.duration ?? 300;
      return executeAdbCommand(
        [...deviceArgs, "shell", "input", "swipe", String(args.x1), String(args.y1), String(args.x2), String(args.y2), String(duration)],
        "Error swiping on screen",
      );
    },
  );

  server.tool(
    "send_text",
    SEND_TEXT_TOOL_DESCRIPTION,
    SendTextSchema.shape,
    async (args: z.infer<typeof SendTextSchema>, _extra: RequestHandlerExtra) => {
      const text = args.text;
      if (!text) {
        return {
          content: [{ type: "text" as const, text: "Text must not be empty" }],
          isError: true,
        };
      }
      log(LogLevel.INFO, `Sending text input (length: ${text.length})`);
      const deviceArgs = buildDeviceArgs(args.device);

      const sanitized = sanitizeInputText(text);

      if (hasNonAscii(sanitized)) {
        return executeAdbCommand(
          [...deviceArgs, "shell", "input", "text", escapeTextUnicode(sanitized)],
          "Error sending text",
        );
      }

      return executeAdbCommand(
        [...deviceArgs, "shell", "input", "text", escapeTextAscii(sanitized)],
        "Error sending text",
      );
    },
  );

  server.tool(
    "key_event",
    KEY_EVENT_TOOL_DESCRIPTION,
    KeyEventSchema.shape,
    async (args: z.infer<typeof KeyEventSchema>, _extra: RequestHandlerExtra) => {
      const keycode = args.keycode.trim();
      if (!keycode) {
        return {
          content: [{ type: "text" as const, text: "Keycode must not be empty" }],
          isError: true,
        };
      }
      log(LogLevel.INFO, `Sending key event: ${keycode}${args.longpress ? " (long-press)" : ""}`);
      const deviceArgs = buildDeviceArgs(args.device);
      const keyArgs = args.longpress
        ? [...deviceArgs, "shell", "input", "keyevent", "--longpress", keycode]
        : [...deviceArgs, "shell", "input", "keyevent", keycode];
      return executeAdbCommand(keyArgs, `Error sending key event ${keycode}`);
    },
  );

  server.tool(
    "perform_system_action",
    SYSTEM_ACTION_TOOL_DESCRIPTION,
    SystemActionSchema.shape,
    async (args: z.infer<typeof SystemActionSchema>, _extra: RequestHandlerExtra) => {
      const actionMap: Record<string, string> = {
        BACK: "KEYCODE_BACK",
        HOME: "KEYCODE_HOME",
        RECENT_APPS: "KEYCODE_APP_SWITCH",
      };
      const keycode = actionMap[args.action];
      log(LogLevel.INFO, `Performing system action: ${args.action} (${keycode})`);
      const deviceArgs = buildDeviceArgs(args.device);
      return executeAdbCommand(
        [...deviceArgs, "shell", "input", "keyevent", keycode],
        `Error performing action ${args.action}`,
      );
    },
  );

  // ===== Activity Manager Tool =====

  server.tool(
    "adb_activity_manager",
    ADB_ACTIVITY_MANAGER_TOOL_DESCRIPTION,
    AdbActivityManagerSchema.shape,
    async (args: z.infer<typeof AdbActivityManagerSchema>, _extra: RequestHandlerExtra) => {
      log(LogLevel.INFO, `Executing Activity Manager command: am ${args.amCommand} ${args.amArgs || ""}`);
      const deviceArgs = buildDeviceArgs(args.device);
      const amCommand = args.amCommand.trim();
      if (!amCommand) {
        const message = "Activity Manager command must not be empty";
        log(LogLevel.ERROR, message);
        return {
          content: [{ type: "text" as const, text: message }],
          isError: true,
        };
      }

      const additionalArgs = args.amArgs ? splitCommandArguments(args.amArgs) : [];
      return executeAdbCommand([...deviceArgs, "shell", "am", amCommand, ...additionalArgs], "Error executing Activity Manager command");
    },
  );

  // ===== Package Manager Tool =====

  server.tool(
    "adb_package_manager",
    ADB_PACKAGE_MANAGER_TOOL_DESCRIPTION,
    AdbPackageManagerSchema.shape,
    async (args: z.infer<typeof AdbPackageManagerSchema>, _extra: RequestHandlerExtra) => {
      log(LogLevel.INFO, `Executing Package Manager command: pm ${args.pmCommand} ${args.pmArgs || ""}`);
      const deviceArgs = buildDeviceArgs(args.device);
      const pmCommand = args.pmCommand.trim();
      if (!pmCommand) {
        const message = "Package Manager command must not be empty";
        log(LogLevel.ERROR, message);
        return {
          content: [{ type: "text" as const, text: message }],
          isError: true,
        };
      }

      const additionalArgs = args.pmArgs ? splitCommandArguments(args.pmArgs) : [];
      return executeAdbCommand([...deviceArgs, "shell", "pm", pmCommand, ...additionalArgs], "Error executing Package Manager command");
    },
  );

  // ===== Interactive Elements & State Tools =====

  server.tool(
    "get_interactive_elements",
    GET_INTERACTIVE_ELEMENTS_DESCRIPTION,
    GetInteractiveElementsSchema.shape,
    async (args: z.infer<typeof GetInteractiveElementsSchema>, _extra: RequestHandlerExtra) => {
      log(LogLevel.INFO, "Getting interactive elements");
      try {
        const xml = await dumpUiHierarchyXml(args.device);
        const parsed = parseUiHierarchy(xml);
        const elements = extractInteractiveElements(parsed);
        log(LogLevel.INFO, `Found ${elements.length} interactive elements`);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(elements, null, 2) }],
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log(LogLevel.ERROR, `Error getting interactive elements: ${errorMsg}`);
        return {
          content: [{ type: "text" as const, text: `Error getting interactive elements: ${errorMsg}` }],
          isError: true,
        };
      }
    },
  );

  // FIX #3: annotated_screenshot now runs UI dump first, then screenshot,
  // so bounding boxes always correspond to the captured screen state.
  server.tool(
    "annotated_screenshot",
    ANNOTATED_SCREENSHOT_DESCRIPTION,
    AnnotatedScreenshotSchema.shape,
    async (args: z.infer<typeof AnnotatedScreenshotSchema>, _extra: RequestHandlerExtra) => {
      log(LogLevel.INFO, "Taking annotated screenshot");
      const scaleFactor = args.scaleFactor ?? 0.7;

      try {
        // Sequential: dump UI first, then take screenshot to avoid race condition
        const xml = await dumpUiHierarchyXml(args.device);
        const screenshot = await takeScreenshotBuffer(args.device, scaleFactor);

        const parsed = parseUiHierarchy(xml);
        const elements = extractInteractiveElements(parsed);
        log(LogLevel.INFO, `Annotating screenshot with ${elements.length} elements`);

        const paddedWidth = screenshot.width + 2 * ANNOTATION_PADDING;
        const paddedHeight = screenshot.height + 2 * ANNOTATION_PADDING;

        const svgOverlay = generateAnnotationSvg(elements, screenshot.width, screenshot.height, scaleFactor);

        const annotatedBuffer = await sharp({
          create: {
            width: paddedWidth,
            height: paddedHeight,
            channels: 3,
            background: { r: 255, g: 255, b: 255 },
          },
        })
          .composite([
            { input: screenshot.buffer, left: ANNOTATION_PADDING, top: ANNOTATION_PADDING },
            { input: svgOverlay, left: 0, top: 0 },
          ])
          .png()
          .toBuffer();

        const base64Image = annotatedBuffer.toString("base64");

        const elementIndex = elements.map((el, i) => ({
          index: i,
          name: el.name,
          className: el.className,
          center: el.center,
        }));

        log(LogLevel.INFO, `Annotated screenshot created (${elements.length} elements, scale: ${scaleFactor})`);

        return {
          content: [
            {
              type: "image" as const,
              data: base64Image,
              mimeType: "image/png",
            },
            { type: "text" as const, text: JSON.stringify(elementIndex, null, 2) },
          ],
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log(LogLevel.ERROR, `Error creating annotated screenshot: ${errorMsg}`);
        return {
          content: [{ type: "text" as const, text: `Error creating annotated screenshot: ${errorMsg}` }],
          isError: true,
        };
      }
    },
  );

  // ========== Server Startup ==========

  try {
    log(LogLevel.INFO, "Starting ADB MCP Server...");
    log(LogLevel.INFO, `Version: ${version}, Log level: ${LogLevel[getLogLevel()]}`);

    // Check ADB availability
    try {
      const { stdout } = await runAdb(["version"]);
      log(LogLevel.INFO, `ADB detected: ${stdout.split("\n")[0]}`);
    } catch {
      log(LogLevel.WARN, "ADB not found in PATH. Please ensure Android Debug Bridge is installed and in your PATH.");
    }

    const transport = new StdioServerTransport();
    await server.connect(transport);
    log(LogLevel.INFO, "ADB MCP Server connected and ready");

    // FIX #10: Graceful shutdown — clean up on SIGTERM/SIGINT
    const shutdown = async () => {
      log(LogLevel.INFO, "Shutting down ADB MCP Server...");
      try {
        await server.close();
      } catch {
        // best-effort
      }
      process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(LogLevel.ERROR, "Error connecting server:", errorMsg);
    process.exit(1);
  }
}

runServer();
