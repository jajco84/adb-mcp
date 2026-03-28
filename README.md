An MCP (Model Context Protocol) server for interacting with Android devices through ADB. This TypeScript-based tool provides a bridge between AI models and Android device functionality.

## Features

- 📱 Device Management - List and interact with connected Android devices
- 📦 App Management - Install APKs, manage packages (pm), and control activities (am)
- 📋 Logging - Access device logs through logcat with level, package, and line filtering
- 🔄 File Transfer - Push and pull files between device and host
- 📸 UI Interaction - Capture screenshots and analyze UI hierarchy with attribute filtering
- 🧠 Smart UI Analysis - Extract structured interactive elements and generate annotated screenshots with labeled bounding boxes
- 👆 Input Simulation - Tap, swipe, type text, and press system keys (Back, Home, Recent Apps)
- 🔧 Shell Command Execution - Run custom commands on the device

## Prerequisites

- Node.js (v16 or higher recommended, tested with Node.js v16, v18, and v20)
- ADB (Android Debug Bridge) installed and in your PATH
- An Android device or emulator connected via USB or network with USB debugging enabled
- Permission to access the device (accepted debugging authorization on device)

## Installation

### Manual Installation
```bash
# Clone the repository
git clone https://github.com/srmorete/adb-mcp.git
cd adb-mcp

# Install dependencies
npm install

# Build the TypeScript code
npm run build

# Run the server
npx adb-mcp
```

## Configuration

### ADB Path Configuration

The server uses default ADB paths. For custom ADB location:

```bash
export ADB_PATH=/path/to/adb
npx adb-mcp
```

### MCP Configuration

#### Claude

```bash
claude mcp add adb-mcp -- node /path/to/adb-mcp/dist/index.js
```

or 

   ```json
   {
     "mcpServers": {
       "adb": {
         "command": "npx",
         "args": [
           "adb-mcp"
         ]
       }
     }
   }
   ```

#### Codex

```bash
codex mcp add adb-mcp -- node /path/to/adb-mcp/dist/index.js
```

or 

   ```toml
[mcp_servers.adb-mcp]
command = "node"
args = ["/path/to/adb-mcp/dist/index.js"]
   ```

## Usage



### Available Tools

All tools are available with the following naming convention:

#### 📱 Device Management

- `adb_devices` - List connected devices
- `adb_shell` - Execute shell commands on a device

#### 📦 App Management

- `adb_install` - Install an APK file using a local file path
- `adb_package_manager` - Execute Package Manager (pm) commands - list packages, grant/revoke permissions, manage apps
- `adb_activity_manager` - Execute Activity Manager (am) commands - start activities, broadcast intents, control app behavior

#### 📋 Logging

- `adb_logcat` - View device logs with optional filtering
  - Filter by log level (`DEBUG`, `WARNING`, `ERROR`)
  - Filter by app package name (resolves PID automatically)
  - Configurable number of output lines

#### 🔄 File Transfer

- `adb_pull` - Pull files from a device
- `adb_push` - Push files to a device

#### 🔍 UI Interaction

- `dump_image` - Take a screenshot of the current screen (supports base64 output, auto-resized to 40% by default, use `scaleFactor=1.0` for full resolution)
- `inspect_ui` - Get UI hierarchy in XML format
  - Return as base64 or plain text
  - Filter returned XML attributes (e.g. only `text,bounds,clickable`) to reduce output size

#### 🧠 Smart UI Analysis

- `get_interactive_elements` - Parse the current screen and return a structured JSON array of all interactive elements, each with `name`, `className`, `center` coordinates, and `boundingBox`
- `get_state` - Get the full screen state as a structured JSON object containing all interactive elements (wrapper around `get_interactive_elements`)
- `annotated_screenshot` - Take a screenshot with numbered, color-coded bounding boxes drawn over each interactive element (returns base64 PNG, default scale 70%)

#### 👆 Input Interaction

- `tap_screen` - Tap on the screen at given (x, y) coordinates — useful for clicking buttons or focusing input fields
- `swipe_screen` - Swipe from one point to another with optional duration control — useful for scrolling or dismissing
- `send_text` - Type text on the device as keyboard input (auto-escapes special characters)
- `perform_system_action` - Press system keys: `BACK`, `HOME`, or `RECENT_APPS`

## Troubleshooting

If tools aren't working:

- **Server Issues:**
  - Check server output for error messages
  - Try detailed logs: `LOG_LEVEL=3 npx adb-mcp`
  - Kill hanging processes:
    - `ps aux | grep "adb-mcp" | grep -v grep`
    - then `kill -9 [PID]`

- **Device Connection:**
  - Verify connection with `adb_devices`
  - If "unauthorized", accept debugging authorization on device
  - Check USB/network connections
  - Try restarting ADB: `adb kill-server && adb start-server`

- **ADB Issues:**
  - Verify ADB installation: `adb version`

- **Device Setup:**
  - Use an emulator (it was built using one), for real devices maybe try this:
    - Ensure USB debugging is enabled
    - For newer Android versions, enable "USB debugging (Security settings)"
    - Try different USB port or cable
    - or let me know in an issue

## Compatibility

- Android 8.0 and higher
- MCP clients including Claude in Cursor IDE
- Was built on macOS but **should** run on any POSIX compatible (Linux etc).
- Did not try on Windows but **maybe** it works.

## Contributing

- Contributions are welcome! Submit a Pull Request.
- For major changes, open an issue to discuss first.
- You can, of course, also fork it
- **Note:** this project was `vibe-coded` so if you spot some weird stuff... well now you know 🙂

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with [Model Context Protocol (MCP)](https://modelcontextprotocol.io/introduction)

- Fork of https://github.com/srmorete/adb-mcp
