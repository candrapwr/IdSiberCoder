# Changelog

## 0.5.0
- Added Google Gemini provider
- Implemented Gemini API integration with proper format conversion from OpenAI format
- Added tool calling support for Gemini's unique function call format
- Enhanced provider factory pattern for better extensibility
- Updated documentation for Google Gemini provider
- Version bump to 0.5.0

## 0.4.0
- Added CLI command execution tool (`execute_cli`) using VSCode Terminal API
- Enhanced security with safe command validation and dangerous pattern blocking
- Support for git, npm, yarn, pnpm, and project management commands
- Added output capture for safe informational commands
- Improved tool system architecture with TerminalManager class
- Version bump to 0.4.0

## 0.3.0
- Added Novita AI provider support with deepseek/deepseek-v3.1-terminus model
- Updated provider configuration to support 6 providers
- Enhanced provider factory pattern for better extensibility
- Updated documentation for Novita AI provider
- Version bump to 0.3.0

## 0.2.0
- Added Claude provider support with Claude-3-7-Sonnet-Latest model
- Fixed Claude API integration with proper tool handling format
- Updated provider configuration to support 5 providers
- Enhanced documentation for Claude provider
- Version bump to 0.2.0

## 0.1.0
- Added Grok provider support with Grok-3-Mini model
- Enhanced multi-provider architecture
- Updated provider configuration to support 4 providers
- Improved documentation and changelog
- Version bump to 0.1.0

## 0.0.3
- Added ZhiPu AI provider support with GLM-4.5-Flash model
- Updated provider configuration and settings management
- Enhanced API key handling for multiple providers
- Updated documentation for new provider

## 0.0.2
- Added OpenAI provider support
- Improved provider factory pattern
- Enhanced settings configuration

## 0.0.1
- Initial scaffolding of IdSiberCoder VS Code extension
- DeepSeek provider plumbing
- Codex-style context optimizer and workspace-aware file tools
- Codex-inspired chat panel skeleton