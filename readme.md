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
  ...configHelper('output.eq_after_comp:output', 'alsa_output.pci-0000_01_00.1.hdmi-stereo:playbook'),
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
- **Config Helper** (`./dist/configHelper.js`): Configuration utilities

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
