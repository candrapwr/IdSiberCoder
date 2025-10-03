# Changelog

## 0.0.2
- Persist model selection per workspace and refresh Settings Manager to re-read configuration each update.
- Allow DeepSeek API key saves via plaintext input and clear competing config values before storing secrets.
- Expand context summaries to track user/assistant/tool turns, keep cumulative history when reloading sessions, and render as collapsible accordions in the panel.
- Simplify the timeline layout by removing the marker column for more readable cards.
- Surface IdSiberCoder in the Activity Bar with a reusable sidebar webview and icon.
- Add repository metadata, MIT license file, README contact info, and publishing guidance for packaging via `vsce`.

## 0.0.1
- Initial scaffolding of IdSiberCoder VS Code extension
- DeepSeek provider plumbing
- Codex-style context optimizer and workspace-aware file tools
- Codex-inspired chat panel skeleton
