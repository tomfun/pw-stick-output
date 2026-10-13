# pw-stick-output

A TypeScript utility for managing PipeWire audio node connections and routing.

## Description

`pw-stick-output` is a Node.js application that helps "stick" PipeWire nodes to specific outputs, 
enabling automated audio routing and connection management in Linux audio systems using PipeWire.

## Features

- Automatic PipeWire node connection management
- Configuration-based audio routing
- TypeScript support with full type definitions
- Systemd integration with journald logging
- Hot-reload development environment

## Installation

```shell script
npm install
```


## Usage

### Building the Project

```shell script
# Build once
npm run build

# Build and watch for changes
npm run build:watch
```


### Running the Application

```shell script
# Production
npm start

# Development (with hot reload)
npm run dev
```


### Running as a Systemd Service

This application is designed to run as a systemd service. It includes:
- **sd-notify** integration for service readiness notification
- **systemd-journald** logging for proper log management
- Service status reporting capabilities

To set up as a [systemd service](/pw-stick-output.service), create a service file that runs the built application and configure it to start automatically.

### Configuration

Create a configuration file similar to `exampleConfig.cjs`:

```javascript
module.exports = [
  ...configHelper('source_node:port', 'destination_node:port'),
  // Add more routing configurations as needed
];
```

The `configHelper` function helps create connection mappings between PipeWire nodes and their ports.

#### Config file formats

`--config` accepts `.cjs`, `.mjs` and `.json`:

- **`.cjs`** — `module.exports = [...]`. Helpers are available as globals or via
  `require('pw-stick-output/configHelper')`.
- **`.mjs`** — `export default [...]` (`module.exports` in an `.mjs` file fails with "Rename file to *.cjs").
  Helpers are available as globals or via `import { configHelper } from 'pw-stick-output/configHelper'`.
- **`.json`** — a plain array of config items (no helpers, see the item shape below).

Globals: `configHelper`, `configHelperAppPlay`, `configHelperRecordForApp`.

#### Routing by application

Application streams get a new node and port ids every time the app restarts, and their port names
(`pw-play:output_FL`) are not always unique. Instead of a port id you can point at an application:

```javascript
module.exports = [
  // old syntax: port id -> port id
  ...configHelper('output.eq_sven:output', 'alsa_output.pci-0000_00_1f.3.analog-stereo:playback'),

  // app playback (its output_FL/FR ports) -> sink
  ...configHelperAppPlay({ binName: 'mpv' }, 'input.eq_sven:playback'),

  // source -> app recording (its input_FL/FR ports)
  ...configHelperRecordForApp('alsa_input.pci-0000_00_1f.3.analog-stereo:capture', { binName: 'parec' }),

  // by process id
  ...configHelperAppPlay({ pid: 12345 }, 'audiorelay_virtual_null:playback'),
];
```

`AppRef` is `{ binName?: string; pid?: number }` (at least one; both must match if both are given).

- **`binName`** matches any of the node's `application.process.binary`, `application.name` or `node.name`.
- **`pid`** matches `application.process.id`.

What PipeWire reports differs by client type, check with `pw-cli info <node id>` (and its `client.id`):

| App | `application.name` / `node.name` | `application.process.binary` |
|---|---|---|
| `pw-play`, `pw-record` (native) | `pw-play` / `pw-record` | `pw-cat` (on the Client object only) |
| `paplay`, `parec` (pipewire-pulse) | `paplay` / `parec` | `pacat` |

So `{ binName: 'pw-play' }`, `{ binName: 'paplay' }` and `{ binName: 'pacat' }` all work. Properties missing
on a native client's node are taken from its Client object, including the pid.

Rules:

- If no node matches, nothing is changed (logged at INFO: `no node matched for app ...`).
- If several nodes match **and** expose the wanted port (e.g. two `pw-play` instances), the item is skipped and
  nothing is changed (logged at WARNING: `ambiguous app match ...`). A shared binary is fine when only one node
  has the port: `pacat` resolves to `paplay` for playback and to `parec` for recording.
- `configHelperRecordForApp` manages the **source's** outgoing links; other inputs of the recorder are left alone.
- Several items for the same source port are merged: a link is removed only if no item wants it.

Item shape (useful for `.json` configs). An endpoint is either `{ "findByid": "node:port_FL" }` or
`{ "findByApp": { "binName": "paplay" }, "portKind": "output" | "input", "channel": "FL" }`:

```json
[
  {
    "findByApp": { "binName": "paplay" }, "portKind": "output", "channel": "FL",
    "stickTo": [{ "findByid": "audiorelay_virtual_null:playback_FL" }],
    "ignoreMonitors": true,
    "ignore": { "object.path": { "match": "^PulseAudio Volume Control:" } }
  }
]
```

Stream nodes use `output_<CH>` (players) and `input_<CH>` (recorders) — `playback_<CH>` is a sink port name.

Here's a concise README section for working with filters and WirePlumber:

### Working with PipeWire Filters and WirePlumber

#### Filter Configuration

PipeWire audio filters (EQ, compressors, etc.) are configured in your PipeWire configuration files. Each filter creates virtual audio nodes that can be connected using `pw-stick-output`.

**Filter Definition Example:**
```conf
// In your PipeWire config (e.g., ~/.config/pipewire/pipewire.conf.d/01-pipewire.conf)
{
  name = libpipewire-module-filter-chain
  args = {
    node.name = "eq_before_comp"           // This becomes the node name for routing
    node.description = "Pre-compressor EQ"
    capture.props = { "media.class": "Audio/Sink" }
    filter.graph = {
      nodes = [
        {
          type = builtin
          label = param_eq
          config = { filename = "/path/to/eq_settings.txt" }
        }
      ]
    }
  }
}
```


#### Finding Node Names for Configuration

Use PipeWire's `pw-link` command to discover available audio nodes and their ports:

```shell script
# List all available output ports
pw-link --output

# Show current connections
pw-link --links
```


**Example output:**
```
output.eq_before_comp:output_FL
output.eq_before_comp:output_FR
input.hcl_compressor:playback_FL
input.hcl_compressor:playback_FR
```


#### Configuration Usage

Use the discovered node names in your `pw-stick-output` configuration:

```javascript
// pw-stick-output-config.cjs
const {configHelper} = require('./pw-stick-output/dist/configHelper.js')

module.exports = [
  // Connect EQ output to compressor input
  ...configHelper('output.eq_before_comp:output', 'input.hcl_compressor:playback'),
  
  // Connect compressor to final EQ
  ...configHelper('output.hcl_compressor:output', 'input.eq_after_comp:playback'),
  
  // Route to hardware output
  ...configHelper('output.eq_after_comp:output', 'alsa_output.pci-0000_01_00.1.hdmi-stereo:playback'),
]
```


**Note:** Filter node names are defined by the `node.name` property in your PipeWire filter configuration. Hardware device names can be found using `pw-link --output` or are typically configured in WirePlumber rules.

## Project Structure

```
pw-stick-output/
├── src/                    # TypeScript source files
│   ├── index.ts            # Main application entry point
│   ├── configHelper.ts     # Configuration helper utilities
│   ├── findModuleByName.ts # PipeWire module discovery
│   ├── log.ts              # Logging functionality
│   └── log.helper.ts       # Logging helper utilities
├── dist/                   # Compiled JavaScript output
├── exampleConfig.cjs       # Example configuration file
├── pw-stick-output.service # Example systemd service file
├── .nvmrc                  # Node.js version specification
└── package.json
```


## Dependencies

### Runtime Dependencies
- **lodash**: Utility library for data manipulation
- **minimist**: Command-line argument parsing
- **sd-notify**: Systemd service notification support
- **systemd-journald**: Systemd journal logging integration

### Development Dependencies
- **TypeScript**: Static type checking and compilation
- **ESLint**: Code linting and formatting
- **Prettier**: Code formatting
- **Concurrently**: Run multiple npm scripts simultaneously
- **Nodemon**: Development server with auto-restart

## API

The package exports the following modules:

- **Main module** (`./dist/index.js`): Core functionality
- **Config Helper** (`./dist/configHelper.js`): `configHelper`, `configHelperAppPlay`, `configHelperRecordForApp`

## Development

1. Clone the repository
2. Use the correct Node.js version: `nvm use`
3. Install dependencies: `npm install`
4. Start development server: `npm run dev`
5. Make changes to files in the `src/` directory
6. The application will automatically rebuild and restart

## License

MIT License - see package.json for details.

## Author

tomfun

---

This tool is designed for Linux systems using PipeWire as the audio server. It provides programmatic control over audio
 routing and can be integrated into systemd services for automatic audio management.
