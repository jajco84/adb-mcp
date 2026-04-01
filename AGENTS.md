# Agent Guidelines for ADB MCP Server

## Tool Selection

- **Start every session** with `adb_devices` to verify a device is connected.
- To understand what is on screen, prefer `get_interactive_elements` (structured JSON) over `inspect_ui` (raw XML). Use `inspect_ui` only when you need the full UI tree or non-interactive elements.
- Use `dump_image` only when you need a visual screenshot (e.g. to show to the user). It returns a PNG image, not parseable data.
- `dump_image` with `scaleFactor < 1.0` returns a resized image; do not take click coordinates from that image without converting them back to native pixels.
- `annotated_screenshot` combines a screenshot with numbered bounding boxes and a JSON index — use it when you need both visual context and element coordinates in one call.

## UI Interaction Workflow

The typical automation loop is:

1. `get_interactive_elements` — get tappable elements with coordinates
2. `tap_screen` at the element's `center.x`, `center.y`
3. If typing: `tap_screen` on the input field first, then `send_text`
4. Verify the result with `get_interactive_elements` or `dump_image`

Do **not** guess coordinates. Always obtain them from `get_interactive_elements`, `annotated_screenshot`, or `inspect_ui` bounds.

## Coordinate System

All coordinates (`tap_screen`, `swipe_screen`, element bounds) are in the device's **native pixel resolution**, not the scaled screenshot resolution. The `scaleFactor` parameter only affects the returned image size — it does not change coordinate space.

## Common Pitfalls

- **`send_text` requires focus first.** Always `tap_screen` on an input field before calling `send_text`.
- **`adb_shell` runs as a single shell string.** Pipes, redirects, and chaining (`&&`, `||`) work inside the command. Avoid interactive commands (`top`, `vi`) — they will hang.
- **`inspect_ui` can be slow** (~2-3 seconds). Prefer `get_interactive_elements` when you only need actionable elements.
- **`adb_logcat` without `appPackage`** returns system-wide logs, which can be very noisy. Always filter by package when debugging a specific app.
- **`adb_activity_manager` and `adb_package_manager`** accept subcommands and args separately. Do not include `am` or `pm` in the command — it is prepended automatically. Example: `amCommand: "start"`, `amArgs: "-n com.example/.MainActivity"`.

## Scrolling

To scroll down a list, use `swipe_screen` from the center of the screen upward:
- `x1: 540, y1: 1400, x2: 540, y2: 600` (on a 1080px-wide device)
- Use `duration: 300` for normal scrolling speed.

After scrolling, call `get_interactive_elements` again — the element list changes.

## Multi-Device

When multiple devices are connected, **every tool call** must include the `device` parameter with the target device ID from `adb_devices`. Without it, ADB picks a device arbitrarily or fails.

## Building & Testing

```bash
npm run build          # compile TypeScript
npm test               # integration tests (requires a connected device/emulator)
npm run dev            # watch mode for development
```

Source code is in `src/index.ts` (server + tools) and `src/types.ts` (Zod schemas). All tools are registered in a single file — search for `server.tool(` to find them.
