# IdSiberCoder - Developer Documentation

This document contains technical documentation for IdSiberCoder extension development.

## Directory Map

```
idSiberCoder/
├── src/
│   ├── extension.ts            # Entry point – wires VS Code APIs to the MCP-style flow + session/provider sync
│   ├── config/                 # Settings manager and provider registry metadata
│   ├── context/                # Conversation optimisation utilities
│   ├── handlers/               # MCP-inspired coordinators (conversation, request, logging, tools, sessions)
│   ├── panels/                 # Webview shell for the chat experience
│   ├── providers/              # DeepSeek/OpenAI clients plus shared provider types
│   └── tools/                  # Workspace file operations consumed by the tool layer
├── media/                      # Webview assets (JS/CSS)
├── esbuild.js                  # Build script for bundling the extension
├── package.json                # Extension manifest, scripts, dependencies
├── tsconfig.json               # TypeScript build settings
└── README.md / DEVELOPMENT.md  # Non-technical overview & this technical reference
```

## Architecture Overview

- **GeneralMCPHandler** mirrors the CLI app's MCP core: it initialises conversation state, manages tool registries, and feeds responses from the active provider back into the loop.
- **RequestHandler** prepares the request payload, forwards the current transcript plus tool definitions to the provider, and captures function-call output.
- **ConversationHandler** keeps the running transcript, applies context optimisation, records tool results as `role: "tool"` messages, and can reload saved histories when switching sessions.
- **SessionManager** persists chat threads in `workspaceState`, derives human-readable titles, and swaps conversation state when users pick a different session.
- **DeepSeekProvider**, **OpenAIProvider**, and **ZhiPuAIProvider** implement a shared `ChatProvider` contract: each talks to `/chat/completions`, passes tool definitions, and normalises `tool_calls` + token usage, while surfacing provider-specific errors.
- **Webview Panel** renders assistant replies, token badges, collapsible tool outputs, a dedicated sessions overlay, a header-driven API-key overlay, and a combined model dropdown; it also exposes loading state back to the extension while requests are in flight.

## Tool Definitions

`buildTooling()` (inside `src/extension.ts`) declares the function metadata shared with the active provider. Current capabilities:

| Function        | Purpose                                                | Required Parameters            |
|-----------------|---------------------------------------------------------|--------------------------------|
| `read_file`     | Read file content relative to the workspace root.       | `file_path`                    |
| `write_file`    | Create or overwrite a file.                             | `file_path`, `content`         |
| `append_to_file`| Append text (creates the file if needed).               | `file_path`, `content`         |
| `delete_file`   | Remove a file inside the workspace.                     | `file_path`                    |
| `copy_file`     | Copy a file to a new location.                          | `source_path`, `destination_path` |
| `move_file`     | Move or rename a file.                                  | `source_path`, `destination_path` |
| `list_directory`| List directory contents (defaults to workspace root).   | Optional `dir_path`            |
| `edit_file`     | Apply sequential find/replace edits to a file.          | `file_path`, `edits[] { find, replace }` |

The `FileManager` class executes these requests; `edit_file` performs simple string replacements in-order.

## Conversation Flow

1. User prompt is appended to history and optimised.
2. The selected provider receives the transcript + tool definitions and returns either text or function calls.
3. When tool calls are present, parameters are parsed, executed locally, and the results are reinserted as `role:"tool"` messages with `tool_call_id` for continuity.
4. The updated history is sent back to the provider until no additional function calls are returned or `maxIterations` is reached.
5. The webview reflects every step (assistant thinking, tool requests, final responses) and displays token usage badges.

## Configuration & Commands

- **Settings**: provider choice (`deepseek`, `openai`, or `zhipuai`), per-provider base URLs/models, provider-specific API keys (stored in `SecretStorage`), context optimisation switches, and `maxIterations` are surfaced through VS Code's settings UI.
- **Commands**: `IdSiberCoder: Open Assistant` (webview) and `IdSiberCoder: Send Prompt` (prompt input) are registered in `package.json`.
- **Build scripts**: The extension is bundled using `esbuild`. Key scripts include `npm run esbuild` (development build) and `npm run esbuild-watch` (watches for changes). Packaging with `vsce package` automatically creates a minified production build.

## Development Notes

- Type declarations for Markdown rendering live in `src/types/markdown-it.d.ts`.
- The extension is bundled using `esbuild` before packaging. The `vscode:prepublish` script handles this automatically.
- Webview assets (`media/`) are plain JS/CSS – the bundler is only configured for the extension's TypeScript source code. The composer exposes a single combined model dropdown, while sessions and API keys are managed through dedicated overlays in the header.
- When adding new tools, update both `buildTooling()` definitions and the `FileManager` implementation, then surface them in the UI if user-facing controls are desired.

## Future Hooks

- Additional providers can slot in by implementing the shared `ChatProvider` contract and registering metadata in `src/config/providers.ts`.
- **ZhiPu AI Provider** is now available with GLM-4.5-Flash as the default model, supporting high-performance Chinese language processing and coding tasks.
- Persisting conversation history or wiring context summaries into storage can reuse the CLI project's session manager patterns.
- The webview currently renders Markdown via `markdown-it`; theming can be extended with CSS variables exposed by VS Code.

## Quick Start for Development

1. `npm install`
2. Open the folder in VS Code and hit **F5** to launch the Extension Development Host.
3. Run the command **IdSiberCoder: Open Assistant**.
4. Enter the API key for your selected provider when prompted (DeepSeek, OpenAI, or ZhiPu AI), or open the **🔑 API Keys** overlay in the panel header to manage credentials later.
5. Start chatting—try asking the assistant to inspect or edit a file in your workspace. Use the sessions icon in the panel header to revisit, rename, or delete earlier threads, and the model dropdown in the composer to pivot between DeepSeek, OpenAI, and ZhiPu AI.

## Contributing

Issues, ideas, and pull requests are welcome. This project is still evolving—feel free to share feedback or reach out to the IdSiber team if you'd like to collaborate.

Prefer a direct line? Email candrapwr@datasiber.com.

## License

This project is licensed under the MIT License. See the accompanying [`LICENSE`](LICENSE) file for the full text.
## Provider Implementation Details

### ZhiPu AI Provider

The `ZhiPuAIProvider` implements support for ZhiPu AI's GLM models:

- **Endpoint**: `https://open.bigmodel.cn/api/paas/v4/chat/completions`
- **Default Model**: `glm-4.5-flash`
- **Authentication**: Uses Bearer token authentication with API key
- **Supported Models**: GLM-4.5-Flash, GLM-4, and other GLM series models

#### Key Implementation Notes:
- Uses standard OpenAI-compatible API format
- Handles tool calls and function calling similar to other providers
- Includes proper error handling for ZhiPu AI specific responses
- Supports streaming responses for real-time interaction

#### Configuration:
- Provider ID: `zhipuai`
- API key stored in VS Code secret storage with prefix `idSiberCoder.apiKey.zhipuai`
- Base URL configurable through settings
- Model selection available in the UI dropdown

#### Usage Example:
```typescript
const provider = new ZhiPuAIProvider(apiKey, baseUrl);
const response = await provider.sendMessage(messages, tools);
```
## 🛠️ Building and Packaging

### Prerequisites
- Node.js 16+
- npm
- VS Code Extension CLI (`npm install -g @vscode/vsce`)

### Build Commands

#### Development Build
```bash
npm run esbuild          # Build with sourcemaps
npm run esbuild:watch    # Watch mode for development
```

#### Production Build
```bash
npm run vscode:prepublish  # Minified production build
```

#### Package Extension
```bash
npm run package           # Create .vsix file
# or
vsce package             # Direct vsce packaging
```

#### Automated Build Scripts
We provide automated build scripts for different platforms:

**Linux/macOS:**
```bash
chmod +x build.sh
./build.sh
```

**Windows (Command Prompt):**
```cmd
build.bat
```

**Windows (PowerShell):**
```powershell
.\build.ps1
```

### Installation
After building the .vsix file:
```bash
code --install-extension idsibercoder-0.0.3.vsix
```

### Publishing
To publish to VS Code Marketplace:
```bash
vsce publish
```

Note: You need to be logged in as the publisher (`DatasiberLab`).