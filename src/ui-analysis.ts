/**
 * UI hierarchy parsing, interactive element extraction, and annotation rendering.
 */

import { readFile } from "fs/promises";
import sharp from "sharp";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { LogLevel, log } from "./logger.js";
import { runAdb, buildDeviceArgs, createTempFilePath, cleanupTempFile, uniqueRemotePath } from "./helpers.js";
import type { UiNode, ElementNode, BoundingBox } from "./types.js";

// ========== Interactive element detection ==========

const DEFAULT_SCREEN_WIDTH = 1080;
const DEFAULT_SCREEN_HEIGHT = 1920;

const INTERACTIVE_CLASSES = new Set([
  "android.widget.EditText",
  "android.widget.Button",
  "android.widget.ImageButton",
  "android.widget.CheckBox",
  "android.widget.RadioButton",
  "android.widget.ToggleButton",
  "android.widget.Switch",
  "android.widget.Spinner",
  "android.widget.SeekBar",
  "android.widget.AutoCompleteTextView",
  "android.widget.MultiAutoCompleteTextView",
  "android.widget.RatingBar",
  "android.widget.NumberPicker",
  "android.widget.DatePicker",
  "android.widget.TimePicker",
]);

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
});

export function parseBounds(boundsStr: string): BoundingBox | null {
  const match = boundsStr.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
  if (!match) return null;
  return {
    x1: parseInt(match[1], 10),
    y1: parseInt(match[2], 10),
    x2: parseInt(match[3], 10),
    y2: parseInt(match[4], 10),
  };
}

function isInteractiveNode(attrs: UiNode): boolean {
  return (
    attrs["@_focusable"] === "true" ||
    attrs["@_clickable"] === "true" ||
    attrs["@_long-clickable"] === "true" ||
    attrs["@_checkable"] === "true" ||
    attrs["@_scrollable"] === "true" ||
    attrs["@_selected"] === "true" ||
    attrs["@_password"] === "true" ||
    INTERACTIVE_CLASSES.has(attrs["@_class"] || "")
  );
}

export function getNodeChildren(node: UiNode): UiNode[] {
  const children: UiNode[] = [];
  if (!node || typeof node !== "object") return children;

  for (const key of Object.keys(node)) {
    if (key.startsWith("@_") || key === "#text") continue;
    const val = node[key];
    if (Array.isArray(val)) {
      children.push(...(val as UiNode[]));
    } else if (typeof val === "object" && val !== null) {
      children.push(val as UiNode);
    }
  }
  return children;
}

export function getElementName(node: UiNode, isRoot: boolean = true): string {
  const contentDesc = node["@_content-desc"];
  const text = node["@_text"];

  if (isRoot && (contentDesc || text)) {
    return (contentDesc || text) as string;
  }

  const texts: string[] = [];
  const fallbackTexts: string[] = [];

  function collectText(n: UiNode, isStartNode: boolean): void {
    const isActionable =
      !isStartNode &&
      (n["@_clickable"] === "true" ||
        n["@_long-clickable"] === "true" ||
        n["@_checkable"] === "true" ||
        n["@_scrollable"] === "true");

    const val = n["@_text"] || n["@_content-desc"] || n["@_hint"];

    if (isActionable) {
      if (val) fallbackTexts.push(val as string);
      return;
    }

    if (val) texts.push(val as string);

    for (const child of getNodeChildren(n)) {
      collectText(child, false);
    }
  }

  collectText(node, true);

  const finalTexts = texts.length > 0 ? texts : fallbackTexts;
  return finalTexts.join(" ").trim();
}

export function extractInteractiveElements(node: UiNode): ElementNode[] {
  const elements: ElementNode[] = [];

  function walk(n: UiNode): void {
    if (!n || typeof n !== "object") return;

    if (n["@_enabled"] === "true" && isInteractiveNode(n)) {
      const boundsStr = n["@_bounds"];
      if (boundsStr) {
        const bb = parseBounds(boundsStr as string);
        if (bb) {
          const className = (n["@_class"] as string) || "";
          let name = getElementName(n, true);
          // Fallback: use resource-id (strip package prefix) or class name
          if (!name) {
            const resId = n["@_resource-id"] as string;
            if (resId) {
              name = resId.includes("/") ? resId.split("/").pop()! : resId;
            } else {
              name = className.includes(".") ? className.split(".").pop()! : className;
            }
          }
          elements.push({
            name: name || "unknown",
            className,
            center: {
              x: Math.round((bb.x1 + bb.x2) / 2),
              y: Math.round((bb.y1 + bb.y2) / 2),
            },
            boundingBox: bb,
          });
        }
      }
    }

    for (const child of getNodeChildren(n)) {
      walk(child);
    }
  }

  walk(node);
  return elements;
}

// ========== XML attribute filtering ==========

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  format: true,
  suppressEmptyNode: false,
});

/**
 * Filters XML attributes by parsing the XML, stripping unwanted attributes
 * from all nodes, and rebuilding the XML. Much more robust than regex.
 */
export function filterXmlAttributes(xmlContent: string, attributesToKeep: Set<string>): string {
  const parsed = xmlParser.parse(xmlContent);

  const prefixedKeep = new Set<string>();
  for (const attr of attributesToKeep) {
    prefixedKeep.add(`@_${attr}`);
  }

  function stripAttrs(obj: unknown): unknown {
    if (obj === null || obj === undefined || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(stripAttrs);

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (key.startsWith("@_")) {
        if (prefixedKeep.has(key)) {
          result[key] = value;
        }
      } else {
        result[key] = stripAttrs(value);
      }
    }
    return result;
  }

  const filtered = stripAttrs(parsed);
  return xmlBuilder.build(filtered) as string;
}

// ========== Device interaction helpers ==========

const UI_DUMP_MAX_RETRIES = 2;

export async function dumpUiHierarchyXml(device?: string): Promise<string> {
  const deviceArgs = buildDeviceArgs(device);

  let lastError: unknown;
  for (let attempt = 0; attempt <= UI_DUMP_MAX_RETRIES; attempt++) {
    const tempFilePath = createTempFilePath("adb-mcp", "window_dump.xml");
    const remotePath = uniqueRemotePath("window_dump.xml");

    try {
      if (attempt > 0) {
        log(LogLevel.WARN, `uiautomator dump retry ${attempt}/${UI_DUMP_MAX_RETRIES}`);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      await runAdb([...deviceArgs, "shell", "uiautomator", "dump", remotePath]);
      await runAdb([...deviceArgs, "pull", remotePath, tempFilePath]);
      return await readFile(tempFilePath, "utf8");
    } catch (error) {
      lastError = error;
    } finally {
      await cleanupTempFile(tempFilePath);
      try { await runAdb([...deviceArgs, "shell", "rm", "-f", remotePath]); } catch { /* best-effort */ }
    }
  }

  throw lastError;
}

export function parseUiHierarchy(xmlContent: string): UiNode {
  return xmlParser.parse(xmlContent) as UiNode;
}

export async function takeScreenshotBuffer(
  device?: string,
  scaleFactor: number = 0.7,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const deviceArgs = buildDeviceArgs(device);
  const tempFilePath = createTempFilePath("adb-mcp", "screenshot.png");
  const remotePath = uniqueRemotePath("screenshot.png");

  try {
    await runAdb([...deviceArgs, "shell", "screencap", "-p", remotePath]);
    await runAdb([...deviceArgs, "pull", remotePath, tempFilePath]);

    const fileBuffer = await readFile(tempFilePath);
    const metadata = await sharp(fileBuffer).metadata();
    const origWidth = metadata.width || DEFAULT_SCREEN_WIDTH;
    const origHeight = metadata.height || DEFAULT_SCREEN_HEIGHT;

    if (scaleFactor >= 1.0) {
      return { buffer: fileBuffer, width: origWidth, height: origHeight };
    }

    const newWidth = Math.round(origWidth * scaleFactor);
    const newHeight = Math.round(origHeight * scaleFactor);

    const buffer = await sharp(fileBuffer)
      .resize(newWidth, newHeight)
      .png()
      .toBuffer();

    log(LogLevel.DEBUG, `Screenshot resized from ${origWidth}x${origHeight} to ${newWidth}x${newHeight} (scale: ${scaleFactor})`);
    return { buffer, width: newWidth, height: newHeight };
  } finally {
    await cleanupTempFile(tempFilePath);
    try { await runAdb([...deviceArgs, "shell", "rm", "-f", remotePath]); } catch { /* best-effort */ }
  }
}

// ========== Annotation rendering ==========

export const ANNOTATION_PADDING = 15;

const ANNOTATION_COLORS = [
  "rgb(230,25,75)", "rgb(60,180,75)", "rgb(0,130,200)", "rgb(245,130,48)",
  "rgb(145,30,180)", "rgb(70,240,240)", "rgb(240,50,230)", "rgb(210,245,60)",
  "rgb(250,190,212)", "rgb(0,128,128)", "rgb(220,190,255)", "rgb(170,110,40)",
  "rgb(128,0,0)", "rgb(170,255,195)", "rgb(0,0,128)", "rgb(128,128,0)",
];

export function generateAnnotationSvg(
  elements: ElementNode[],
  width: number,
  height: number,
  scaleFactor: number,
): Buffer {
  const padding = ANNOTATION_PADDING;
  const svgWidth = width + 2 * padding;
  const svgHeight = height + 2 * padding;

  let svgContent = "";
  for (let i = 0; i < elements.length; i++) {
    const bb = elements[i].boundingBox;
    const color = ANNOTATION_COLORS[i % ANNOTATION_COLORS.length];
    const x1 = Math.round(bb.x1 * scaleFactor) + padding;
    const y1 = Math.round(bb.y1 * scaleFactor) + padding;
    const x2 = Math.round(bb.x2 * scaleFactor) + padding;
    const w = x2 - x1;
    const h = Math.round(bb.y2 * scaleFactor) + padding - y1;

    const label = String(i);
    const labelWidth = label.length * 8 + 4;
    const labelHeight = 16;
    const labelX = x2 - labelWidth;
    const labelY = Math.max(0, y1 - labelHeight - 2);

    svgContent += `<rect x="${x1}" y="${y1}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="2"/>`;
    svgContent += `<rect x="${labelX}" y="${labelY}" width="${labelWidth}" height="${labelHeight}" fill="${color}"/>`;
    svgContent += `<text x="${labelX + 2}" y="${labelY + 12}" font-size="12" font-family="monospace" fill="white">${label}</text>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">${svgContent}</svg>`;
  return Buffer.from(svg);
}
