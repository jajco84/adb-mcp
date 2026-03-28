import { describe, it, expect } from "vitest";
import {
  parseBounds,
  getNodeChildren,
  getElementName,
  extractInteractiveElements,
  parseUiHierarchy,
  generateAnnotationSvg,
} from "../src/ui-analysis.js";
import type { UiNode } from "../src/types.js";

describe("parseBounds", () => {
  it("parses standard bounds string", () => {
    expect(parseBounds("[0,0][1080,1920]")).toEqual({
      x1: 0,
      y1: 0,
      x2: 1080,
      y2: 1920,
    });
  });

  it("parses bounds with non-zero origin", () => {
    expect(parseBounds("[100,200][300,400]")).toEqual({
      x1: 100,
      y1: 200,
      x2: 300,
      y2: 400,
    });
  });

  it("parses bounds with negative coordinates", () => {
    expect(parseBounds("[-10,-20][100,200]")).toEqual({
      x1: -10,
      y1: -20,
      x2: 100,
      y2: 200,
    });
  });

  it("returns null for invalid bounds", () => {
    expect(parseBounds("invalid")).toBeNull();
    expect(parseBounds("")).toBeNull();
    expect(parseBounds("[0,0]")).toBeNull();
  });
});

describe("getNodeChildren", () => {
  it("returns empty array for node with no children", () => {
    const node: UiNode = { "@_text": "hello" };
    expect(getNodeChildren(node)).toEqual([]);
  });

  it("returns single child object as array", () => {
    const child: UiNode = { "@_text": "child" };
    const node: UiNode = { node: child };
    expect(getNodeChildren(node)).toEqual([child]);
  });

  it("returns array children", () => {
    const children: UiNode[] = [
      { "@_text": "one" },
      { "@_text": "two" },
    ];
    const node: UiNode = { node: children };
    expect(getNodeChildren(node)).toEqual(children);
  });

  it("skips attribute keys (@_ prefixed)", () => {
    const node: UiNode = {
      "@_text": "hello",
      "@_class": "android.widget.Button",
      node: { "@_text": "child" },
    };
    const children = getNodeChildren(node);
    expect(children).toHaveLength(1);
    expect(children[0]["@_text"]).toBe("child");
  });

  it("handles null/undefined input gracefully", () => {
    expect(getNodeChildren(null as unknown as UiNode)).toEqual([]);
    expect(getNodeChildren(undefined as unknown as UiNode)).toEqual([]);
  });
});

describe("getElementName", () => {
  it("returns text attribute for root node", () => {
    const node: UiNode = { "@_text": "Submit" };
    expect(getElementName(node, true)).toBe("Submit");
  });

  it("returns content-desc over text for root node", () => {
    const node: UiNode = {
      "@_text": "btn",
      "@_content-desc": "Submit button",
    };
    expect(getElementName(node, true)).toBe("Submit button");
  });

  it("collects text from child nodes", () => {
    const node: UiNode = {
      "@_enabled": "true",
      node: [
        { "@_text": "Hello" } as UiNode,
        { "@_text": "World" } as UiNode,
      ],
    };
    expect(getElementName(node, true)).toBe("Hello World");
  });

  it("returns empty string for node with no text", () => {
    const node: UiNode = { "@_class": "android.widget.Button" };
    expect(getElementName(node, true)).toBe("");
  });

  it("skips text from actionable child nodes (uses as fallback)", () => {
    const node: UiNode = {
      node: [
        { "@_text": "static text" } as UiNode,
        { "@_text": "clickable child", "@_clickable": "true" } as UiNode,
      ],
    };
    const name = getElementName(node, true);
    expect(name).toBe("static text");
  });
});

describe("extractInteractiveElements", () => {
  it("extracts clickable elements", () => {
    const node: UiNode = {
      node: {
        "@_text": "Submit",
        "@_class": "android.widget.Button",
        "@_clickable": "true",
        "@_enabled": "true",
        "@_bounds": "[100,200][300,400]",
      } as UiNode,
    };
    const elements = extractInteractiveElements(node);
    expect(elements).toHaveLength(1);
    expect(elements[0].name).toBe("Submit");
    expect(elements[0].className).toBe("android.widget.Button");
    expect(elements[0].center).toEqual({ x: 200, y: 300 });
    expect(elements[0].boundingBox).toEqual({
      x1: 100,
      y1: 200,
      x2: 300,
      y2: 400,
    });
  });

  it("extracts focusable elements", () => {
    const node: UiNode = {
      node: {
        "@_text": "Username",
        "@_class": "android.widget.EditText",
        "@_focusable": "true",
        "@_enabled": "true",
        "@_bounds": "[0,0][500,100]",
      } as UiNode,
    };
    const elements = extractInteractiveElements(node);
    expect(elements).toHaveLength(1);
    expect(elements[0].name).toBe("Username");
  });

  it("skips disabled elements", () => {
    const node: UiNode = {
      node: {
        "@_text": "Disabled",
        "@_clickable": "true",
        "@_enabled": "false",
        "@_bounds": "[0,0][100,100]",
      } as UiNode,
    };
    const elements = extractInteractiveElements(node);
    expect(elements).toHaveLength(0);
  });

  it("skips non-interactive elements", () => {
    const node: UiNode = {
      node: {
        "@_text": "Static text",
        "@_class": "android.widget.TextView",
        "@_enabled": "true",
        "@_bounds": "[0,0][100,100]",
      } as UiNode,
    };
    const elements = extractInteractiveElements(node);
    expect(elements).toHaveLength(0);
  });

  it("extracts elements from interactive class even without clickable flag", () => {
    const node: UiNode = {
      node: {
        "@_text": "Enter text",
        "@_class": "android.widget.EditText",
        "@_enabled": "true",
        "@_bounds": "[50,50][500,150]",
      } as UiNode,
    };
    const elements = extractInteractiveElements(node);
    expect(elements).toHaveLength(1);
  });

  it("uses resource-id as fallback name", () => {
    const node: UiNode = {
      node: {
        "@_resource-id": "com.example:id/submit_btn",
        "@_class": "android.widget.Button",
        "@_clickable": "true",
        "@_enabled": "true",
        "@_bounds": "[0,0][100,100]",
      } as UiNode,
    };
    const elements = extractInteractiveElements(node);
    expect(elements[0].name).toBe("submit_btn");
  });

  it("uses class name as last-resort fallback", () => {
    const node: UiNode = {
      node: {
        "@_class": "android.widget.Button",
        "@_clickable": "true",
        "@_enabled": "true",
        "@_bounds": "[0,0][100,100]",
      } as UiNode,
    };
    const elements = extractInteractiveElements(node);
    expect(elements[0].name).toBe("Button");
  });

  it("extracts multiple nested elements", () => {
    const node: UiNode = {
      node: [
        {
          "@_text": "First",
          "@_clickable": "true",
          "@_enabled": "true",
          "@_bounds": "[0,0][100,50]",
        } as UiNode,
        {
          "@_text": "Second",
          "@_clickable": "true",
          "@_enabled": "true",
          "@_bounds": "[0,50][100,100]",
        } as UiNode,
      ],
    };
    const elements = extractInteractiveElements(node);
    expect(elements).toHaveLength(2);
    expect(elements[0].name).toBe("First");
    expect(elements[1].name).toBe("Second");
  });

  it("returns empty array for empty tree", () => {
    const node: UiNode = {};
    expect(extractInteractiveElements(node)).toEqual([]);
  });
});

describe("parseUiHierarchy", () => {
  it("parses minimal UI XML", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node text="Hello" class="android.widget.TextView" bounds="[0,0][100,50]" />
</hierarchy>`;
    const parsed = parseUiHierarchy(xml);
    expect(parsed).toBeDefined();
    expect(parsed.hierarchy).toBeDefined();
  });

  it("parses nested nodes", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node text="Parent" class="android.widget.FrameLayout" bounds="[0,0][1080,1920]">
    <node text="Child" class="android.widget.Button" bounds="[100,100][200,200]" clickable="true" enabled="true" />
  </node>
</hierarchy>`;
    const parsed = parseUiHierarchy(xml);
    expect(parsed).toBeDefined();
  });
});

describe("generateAnnotationSvg", () => {
  it("generates valid SVG with elements", () => {
    const elements = [
      {
        name: "Submit",
        className: "android.widget.Button",
        center: { x: 200, y: 300 },
        boundingBox: { x1: 100, y1: 200, x2: 300, y2: 400 },
      },
    ];
    const svg = generateAnnotationSvg(elements, 1080, 1920, 0.5);
    const svgStr = svg.toString("utf8");
    expect(svgStr).toContain("<svg");
    expect(svgStr).toContain("</svg>");
    expect(svgStr).toContain("<rect");
    expect(svgStr).toContain("<text");
    expect(svgStr).toContain("0"); // label text
  });

  it("returns SVG with correct dimensions including padding", () => {
    const svg = generateAnnotationSvg([], 1080, 1920, 1.0);
    const svgStr = svg.toString("utf8");
    // padding = 15, so width = 1080 + 30 = 1110, height = 1920 + 30 = 1950
    expect(svgStr).toContain('width="1110"');
    expect(svgStr).toContain('height="1950"');
  });

  it("generates empty SVG for no elements", () => {
    const svg = generateAnnotationSvg([], 500, 800, 1.0);
    const svgStr = svg.toString("utf8");
    expect(svgStr).toContain("<svg");
    expect(svgStr).not.toContain("<rect");
  });

  it("scales bounding box coordinates", () => {
    const elements = [
      {
        name: "Btn",
        className: "Button",
        center: { x: 150, y: 150 },
        boundingBox: { x1: 100, y1: 100, x2: 200, y2: 200 },
      },
    ];
    const svg = generateAnnotationSvg(elements, 1080, 1920, 0.5);
    const svgStr = svg.toString("utf8");
    // x1 = round(100 * 0.5) + 15 = 65, y1 = round(100 * 0.5) + 15 = 65
    expect(svgStr).toContain('x="65"');
    expect(svgStr).toContain('y="65"');
  });
});
