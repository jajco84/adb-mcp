/**
 * Type definitions for the ADB MCP Server
 */

import { z } from 'zod';

// Re-export RequestHandlerExtra from MCP SDK
export type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";

/**
 * Response type for command execution
 */
export interface CommandResponse {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  isError?: boolean;
}

/**
 * Represents a parsed XML node from the UI hierarchy.
 * Attributes are prefixed with @_ by fast-xml-parser.
 */
export interface UiNode {
  "@_text"?: string;
  "@_content-desc"?: string;
  "@_hint"?: string;
  "@_class"?: string;
  "@_package"?: string;
  "@_resource-id"?: string;
  "@_bounds"?: string;
  "@_enabled"?: string;
  "@_clickable"?: string;
  "@_focusable"?: string;
  "@_focused"?: string;
  "@_long-clickable"?: string;
  "@_checkable"?: string;
  "@_checked"?: string;
  "@_scrollable"?: string;
  "@_selected"?: string;
  "@_password"?: string;
  [key: string]: unknown;
}

// Interactive element interfaces
export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ElementNode {
  name: string;
  className: string;
  center: { x: number; y: number };
  boundingBox: BoundingBox;
}

// Zod schema objects
export const AdbDevicesSchema = z.object({});

export const AdbShellSchema = z.object({
  command: z.string().describe("Shell command to execute on the device"),
  device: z.string().optional().describe("Specific device ID (optional)"),
});

export const AdbInstallSchema = z.object({
  apkPath: z.string().describe("Local path to the APK file"),
  device: z.string().optional().describe("Specific device ID (optional)"),
});

export const AdbLogcatSchema = z.object({
  filter: z.string().optional().describe("Logcat filter expression (optional)"),
  device: z.string().optional().describe("Specific device ID (optional)"),
  lines: z.number().optional().default(50).describe("Number of lines to return (default: 50)"),
  appPackage: z.string().optional().describe("App package name to filter logs by PID (e.g. 'com.example.app'). Only logs from this app's process will be returned."),
  logLevel: z.enum(["VERBOSE", "DEBUG", "INFO", "WARNING", "ERROR"]).optional().describe("Minimum log level to filter: VERBOSE (V), DEBUG (D), INFO (I), WARNING (W), or ERROR (E). Maps to logcat priority filter."),
});

export const AdbPullSchema = z.object({
  remotePath: z.string().describe("Remote file path on the device"),
  device: z.string().optional().describe("Specific device ID (optional)"),
  asBase64: z.boolean().optional().default(true).describe("Return file content as base64 (default: true)"),
});

export const AdbPushSchema = z.object({
  fileBase64: z.string().describe("Base64 encoded file content to push"),
  remotePath: z.string().describe("Remote file path on the device"),
  device: z.string().optional().describe("Specific device ID (optional)"),
});

export const AdbScreenshotSchema = z.object({
  device: z.string().optional().describe("Specific device ID (optional)"),
  scaleFactor: z.number().min(0.1).max(1.0).optional().default(0.4).describe("Scale factor for resizing the screenshot (0.1–1.0, default: 0.4 = 40%). Set to 1.0 for full resolution. Smaller values reduce transfer size and speed up processing."),
});

export const AdbUidumpSchema = z.object({
  device: z.string().optional().describe("Specific device ID (optional)"),
  asBase64: z.boolean().optional().default(false).describe("Return XML content as base64 (default: false)"),
  returnedAttributes: z.string().optional().describe(
    "Comma-separated list of attributes to return for each XML node. " +
    "When specified, only these attributes are kept in the output, reducing noise. " +
    "Possible attributes: index, text, resource-id, class, package, content-desc, " +
    "checkable, checked, clickable, enabled, focusable, focused, scrollable, " +
    "long-clickable, password, selected, bounds, drawing-order, hint."
  ),
});

export const TapScreenSchema = z.object({
  x: z.number().describe("The x-coordinate of the point to tap"),
  y: z.number().describe("The y-coordinate of the point to tap"),
  device: z.string().optional().describe("Specific device ID (optional)"),
});

export const SwipeScreenSchema = z.object({
  x1: z.number().describe("The x-coordinate of the starting point of the swipe"),
  y1: z.number().describe("The y-coordinate of the starting point of the swipe"),
  x2: z.number().describe("The x-coordinate of the ending point of the swipe"),
  y2: z.number().describe("The y-coordinate of the ending point of the swipe"),
  duration: z.number().optional().describe("Swipe duration in milliseconds (optional, default: 300)"),
  device: z.string().optional().describe("Specific device ID (optional)"),
});

export const SendTextSchema = z.object({
  text: z.string().describe("The text to send to the device, as if typed on a keyboard"),
  device: z.string().optional().describe("Specific device ID (optional)"),
});

export const SystemActionSchema = z.object({
  action: z.enum(["BACK", "HOME", "RECENT_APPS"]).describe(
    "The system action to perform: " +
    "BACK (press the system back button), " +
    "HOME (go to the home screen), " +
    "RECENT_APPS (open the recent apps view)."
  ),
  device: z.string().optional().describe("Specific device ID (optional)"),
});

export const AdbActivityManagerSchema = z.object({
  amCommand: z.string().describe("Activity Manager subcommand, e.g. 'start', 'broadcast', 'force-stop', etc."),
  amArgs: z.string().optional().describe("Arguments for the am subcommand, e.g. '-a android.intent.action.VIEW'"),
  device: z.string().optional().describe("Specific device ID (optional)"),
});

export const AdbPackageManagerSchema = z.object({
  pmCommand: z.string().describe("Package Manager subcommand, e.g. 'list', 'install', 'uninstall', 'grant', 'revoke', etc."),
  pmArgs: z.string().optional().describe("Arguments for the pm subcommand, e.g. 'packages', 'com.example.app android.permission.CAMERA'"),
  device: z.string().optional().describe("Specific device ID (optional)"),
});

export const KeyEventSchema = z.object({
  keycode: z.string().describe(
    "Android keycode to send (e.g. 'KEYCODE_ENTER', 'KEYCODE_DEL', 'KEYCODE_VOLUME_UP', 'KEYCODE_TAB', 'KEYCODE_DPAD_DOWN'). " +
    "Full list: https://developer.android.com/reference/android/view/KeyEvent"
  ),
  longpress: z.boolean().optional().default(false).describe("Send as long-press event (default: false)"),
  device: z.string().optional().describe("Specific device ID (optional)"),
});

export const GetInteractiveElementsSchema = z.object({
  device: z.string().optional().describe("Specific device ID (optional)"),
});

export const AnnotatedScreenshotSchema = z.object({
  device: z.string().optional().describe("Specific device ID (optional)"),
  scaleFactor: z.number().min(0.1).max(1.0).optional().default(0.7).describe("Scale factor for resizing the screenshot (0.1–1.0, default: 0.7 = 70%)."),
});
