# Development Reference

This document captures the technical shape of the IdSiberCoder extension so future updates stay aligned with the current architecture.

## Directory Map

```
idSiberCoder/
├── src/
│   ├── extension.ts            # Entry point – wires VS Code APIs to the MCP-style flow
│   ├── context/                # Conversation optimisation utilities
│   ├── handlers/               # MCP-inspired coordinators (conversation, request, logging, tools)
│   ├── panels/                 # Webview shell for the chat experience
│   ├── providers/              # DeepSeek client wrapper
│   └── tools/                  # Workspace file operations consumed by the tool layer
├── media/                      # Webview assets (JS/CSS)
├── package.json                # Extension manifest, scripts, dependencies
├── tsconfig.json               # TypeScript build settings
└── README.md / DEVELOPMENT.md  # Non-technical overview & this technical reference
```

## Architecture Overview

- **GeneralMCPHandler** mirrors the CLI app’s MCP core: it initialises conversation state, manages tool registries, and feeds DeepSeek responses back into the loop.
- **RequestHandler** prepares the request payload, forwards the current transcript plus tool definitions to DeepSeek, and captures function-call output.
- **ConversationHandler** keeps the running transcript, applies context optimisation, and records tool results as `role: "tool"` messages so DeepSeek can chain calls.
- **DeepSeekProvider** speaks directly to `/chat/completions`, sending structured tool definitions and unpacking returned tool calls (`tool_calls`) and usage/token stats.
- **Webview Panel** renders assistant replies, token badges, and collapsible tool outputs; it also exposes loading state back to the extension while requests are in flight.

## Tool Definitions

`buildTooling()` (inside `src/extension.ts`) declares the function metadata shared with DeepSeek. Current capabilities:

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
2. DeepSeek receives the transcript + tool definitions and returns either text or function calls.
3. When tool calls are present, parameters are parsed, executed locally, and the results are reinserted as `role:"tool"` messages with `tool_call_id` for continuity.
4. The updated history is sent back to DeepSeek until no additional function calls are returned or `maxIterations` is reached.
5. The webview reflects every step (assistant thinking, tool requests, final responses) and displays token usage badges.

## Configuration & Commands

- **Settings**: `idSiberCoder.apiKey`, `baseUrl`, `model`, context optimisation switches, and `maxIterations` are surfaced through VS Code’s settings UI.
- **Commands**: `IdSiberCoder: Open Assistant` (webview) and `IdSiberCoder: Send Prompt` (prompt input) are registered in `package.json`.
- **Build scripts**: `npm run compile` (TypeScript build), `npm run watch`, and `npm test` (placeholder).

## Development Notes

- Type declarations for Markdown rendering live in `src/types/markdown-it.d.ts`.
- The extension uses TypeScript strict mode; run `npm run compile` before packaging.
- Webview assets are plain JS/CSS – no bundler is currently wired in.
- When adding new tools, update both `buildTooling()` definitions and the `FileManager` implementation, then surface them in the UI if user-facing controls are desired.

## Future Hooks

- Additional providers can slot in by extending `DeepSeekProvider` or introducing a provider interface in `GeneralMCPHandler`.
- Persisting conversation history or wiring context summaries into storage can reuse the CLI project’s session manager patterns.
- The webview currently renders Markdown via `markdown-it`; theming can be extended with CSS variables exposed by VS Code.

