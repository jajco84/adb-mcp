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
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * Resource response format
 */
export interface ResourceResponse {
  contents: Array<{ uri: string; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

// Schema definitions for tool inputs
export const adbDevicesInputSchema = {};

export const adbShellInputSchema = {
  command: z.string().describe("Shell command to execute on the device"),
  device: z.string().optional().describe("Specific device ID (optional)")
};

export const adbInstallInputSchema = {
  apkPath: z.string().describe("Local path to the APK file"),
  device: z.string().optional().describe("Specific device ID (optional)")
};

export const adbLogcatInputSchema = {
  filter: z.string().optional().describe("Logcat filter expression (optional)"),
  device: z.string().optional().describe("Specific device ID (optional)"),
  lines: z.number().optional().default(50).describe("Number of lines to return (default: 50)"),
  appPackage: z.string().optional().describe("App package name to filter logs by PID (e.g. 'com.example.app'). Only logs from this app's process will be returned."),
  logLevel: z.enum(["DEBUG", "WARNING", "ERROR"]).optional().describe("Minimum log level to filter: DEBUG (D), WARNING (W), or ERROR (E). Maps to logcat priority filter.")
};

export const adbPullInputSchema = {
  remotePath: z.string().describe("Remote file path on the device"),
  device: z.string().optional().describe("Specific device ID (optional)"),
  asBase64: z.boolean().optional().default(true).describe("Return file content as base64 (default: true)")
};

export const adbPushInputSchema = {
  fileBase64: z.string().describe("Base64 encoded file content to push"),
  remotePath: z.string().describe("Remote file path on the device"),
  device: z.string().optional().describe("Specific device ID (optional)")
};

export const dumpImageInputSchema = {
  device: z.string().optional().describe("Specific device ID (optional)"),
  asBase64: z.boolean().optional().default(false).describe("Return image as base64 (default: false)"),
  scaleFactor: z.number().optional().default(0.4).describe("Scale factor for resizing the screenshot (default: 0.4 = 40%). Set to 1.0 for full resolution. Smaller values reduce transfer size and speed up processing.")
};

export const inspectUiInputSchema = {
  device: z.string().optional().describe("Specific device ID (optional)"),
  outputPath: z.string().optional().describe("Custom output path on device (default: /sdcard/window_dump.xml)"),
  asBase64: z.boolean().optional().default(false).describe("Return XML content as base64 (default: false)"),
  returnedAttributes: z.string().optional().describe(
    "Comma-separated list of attributes to return for each XML node. " +
    "When specified, only these attributes are kept in the output, reducing noise. " +
    "Possible attributes: index, text, resource-id, class, package, content-desc, " +
    "checkable, checked, clickable, enabled, focusable, focused, scrollable, " +
    "long-clickable, password, selected, bounds, drawing-order, hint."
  )
};

// Interactive elements tool schemas
export const getInteractiveElementsInputSchema = {
  device: z.string().optional().describe("Specific device ID (optional)")
};

export const annotatedScreenshotInputSchema = {
  device: z.string().optional().describe("Specific device ID (optional)"),
  scaleFactor: z.number().min(0.1).max(1.0).optional().default(0.7).describe("Scale factor for resizing the screenshot (0.1–1.0, default: 0.7 = 70%).")
};

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

// Input interaction tool schemas
export const tapScreenInputSchema = {
  x: z.number().describe("The x-coordinate of the point to tap"),
  y: z.number().describe("The y-coordinate of the point to tap"),
  device: z.string().optional().describe("Specific device ID (optional)")
};

export const swipeScreenInputSchema = {
  x1: z.number().describe("The x-coordinate of the starting point of the swipe"),
  y1: z.number().describe("The y-coordinate of the starting point of the swipe"),
  x2: z.number().describe("The x-coordinate of the ending point of the swipe"),
  y2: z.number().describe("The y-coordinate of the ending point of the swipe"),
  duration: z.number().optional().describe("Swipe duration in milliseconds (optional, default: 300)"),
  device: z.string().optional().describe("Specific device ID (optional)")
};

export const sendTextInputSchema = {
  text: z.string().describe("The text to send to the device, as if typed on a keyboard"),
  device: z.string().optional().describe("Specific device ID (optional)")
};

export const systemActionInputSchema = {
  action: z.enum(["BACK", "HOME", "RECENT_APPS"]).describe(
    "The system action to perform: " +
    "BACK (press the system back button), " +
    "HOME (go to the home screen), " +
    "RECENT_APPS (open the recent apps view)."
  ),
  device: z.string().optional().describe("Specific device ID (optional)")
};

// Activity Manager tool schema
export const adbActivityManagerSchema = z.object({
  amCommand: z.string().describe("Activity Manager subcommand, e.g. 'start', 'broadcast', 'force-stop', etc."),
  amArgs: z.string().optional().describe("Arguments for the am subcommand, e.g. '-a android.intent.action.VIEW'"),
  device: z.string().optional().describe("Specific device ID (optional)")
});

// Package Manager tool schema
export const adbPackageManagerSchema = z.object({
  pmCommand: z.string().describe("Package Manager subcommand, e.g. 'list', 'install', 'uninstall', 'grant', 'revoke', etc."),
  pmArgs: z.string().optional().describe("Arguments for the pm subcommand, e.g. 'packages', 'com.example.app android.permission.CAMERA'"),
  device: z.string().optional().describe("Specific device ID (optional)")
});



// Zod schema objects
export const AdbDevicesSchema = z.object(adbDevicesInputSchema);
export const AdbShellSchema = z.object(adbShellInputSchema);
export const AdbInstallSchema = z.object(adbInstallInputSchema);
export const AdbLogcatSchema = z.object(adbLogcatInputSchema);
export const AdbPullSchema = z.object(adbPullInputSchema);
export const AdbPushSchema = z.object(adbPushInputSchema);
export const AdbScreenshotSchema = z.object(dumpImageInputSchema);
export const AdbUidumpSchema = z.object(inspectUiInputSchema);
export const TapScreenSchema = z.object(tapScreenInputSchema);
export const SwipeScreenSchema = z.object(swipeScreenInputSchema);
export const SendTextSchema = z.object(sendTextInputSchema);
export const SystemActionSchema = z.object(systemActionInputSchema);
export const AdbActivityManagerSchema = adbActivityManagerSchema;
export const AdbPackageManagerSchema = adbPackageManagerSchema;
export const GetInteractiveElementsSchema = z.object(getInteractiveElementsInputSchema);
export const AnnotatedScreenshotSchema = z.object(annotatedScreenshotInputSchema);