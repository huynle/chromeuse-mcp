# Contributing

Thanks for helping improve ChromeUse MCP. This project is intended to be useful as a local developer tool, so reliability, clear behavior, and security awareness matter more than feature count.

## Before You Start

- Search existing issues and pull requests before opening a new one.
- For bugs, include reproduction steps and environment details.
- For feature requests, describe the workflow you want to enable and which MCP client you use.
- For security issues, do not open a public issue. Follow `SECURITY.md`.

## Development Setup

```sh
npm install
./scripts/build.sh
npm test
```

For extension development:

```sh
./scripts/dev.sh
```

Reload the unpacked extension in `chrome://extensions` after extension changes.

## Pull Request Checklist

- Keep changes focused and minimal.
- Update `README.md` or files in `docs/` when behavior, setup, or tool inputs change.
- Add or update tests for behavior changes where practical.
- Run `npm test` before opening the PR.
- Run `./scripts/build.sh` before opening the PR.
- Mention any manual browser testing you performed.

## Code Style

- TypeScript is used across the workspaces.
- Keep shared protocol types in `shared/` when multiple components need them.
- Keep browser-specific behavior inside `extension/`.
- Keep MCP protocol behavior inside `mcp-server/`.
- Keep native messaging and local process behavior inside `native-host/`.

## Reporting Bugs

Please include:

- Operating system and version.
- Browser name and version.
- Node.js version.
- MCP client name and version when relevant.
- Steps to reproduce.
- Expected behavior.
- Actual behavior.
- Relevant console output, MCP error text, or screenshots.

## Feature Requests

Good feature requests explain:

- The user workflow or automation scenario.
- Why existing tools are insufficient.
- Any security or permission implications.
- Whether the behavior belongs in the extension, native host, MCP server, or shared protocol.
