# IdSiberCoder

IdSiberCoder is the VS Code companion app for the IdSiber ecosystem. Install it when you want a friendly AI teammate right next to your editor—one who understands the current workspace, talks through its reasoning, and can pitch in on daily coding chores without leaving your project window.

## Highlights

- **Chat-first workflow** – open the IdSiberCoder panel and talk to your assistant like a coding partner.
- **Workspace aware** – read, edit, append, delete, move, or copy files in the currently opened folder (with safe guards).
- **DeepSeek superpowers** – leverages DeepSeek’s function-calling API to trigger tools automatically and narrate the results.
- **Smart context** – keeps long sessions tidy by summarising older turns and only replaying the essentials.
- **Clean timeline** – assistant thoughts, tool calls, and outputs are rendered in a collapsible, easy-to-scan history.

## Quick Start

1. `npm install`
2. Open the folder in VS Code and hit **F5** to launch the Extension Development Host.
3. Run the command **IdSiberCoder: Open Assistant**.
4. Enter your DeepSeek API key when prompted (or set it under Extension Settings).
5. Start chatting—try asking the assistant to inspect or edit a file in your workspace.

## Why you might love it

- You prefer a conversational helper that stays inside VS Code.
- You want to demo IdSiber’s multi-tool experience without spinning up the full CLI.
- You enjoy keeping AI output and tool logs visible in one tidy panel.

## Roadmap Glimpse

- Additional provider adapters (Claude, OpenAI, Qwen, and friends)
- Richer analysis and directory tools beyond core file ops
- Session persistence and sharing
- UI flourishes (diff viewers, inline actions, themed badges)

## Contributing

Issues, ideas, and pull requests are welcome. This project is still evolving—feel free to share feedback or reach out to the IdSiber team if you’d like to collaborate.

## License

This project is licensed under the MIT License. See the accompanying [`LICENSE`](LICENSE) file for the full text.
