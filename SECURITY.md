# Security Policy

ChromeUse MCP is a local browser automation tool for trusted users and trusted MCP clients. It is not a sandbox for untrusted prompts, untrusted agents, or untrusted MCP clients.

## Supported Versions

The project is currently pre-1.0. Security fixes will target the latest commit on the default branch unless a release process is added later.

## Reporting a Vulnerability

Please report security issues privately instead of opening a public GitHub issue.

Preferred process:

1. Open a private vulnerability report on GitHub if available for this repository.
2. If private reporting is not available, contact the maintainer through the GitHub profile associated with the repository.
3. Include reproduction steps, impact, affected component, and any suggested mitigation.

## Security Model

ChromeUse MCP assumes:

- The local machine is trusted.
- The configured MCP client is trusted.
- The browser profile is controlled by the user.
- The loaded ChromeUse extension ID is intentionally registered in the native messaging manifest.

ChromeUse MCP does not assume:

- Web pages are trusted.
- Prompts sent to an MCP client are safe.
- Tool calls are harmless.
- JavaScript executed through `javascript_tool` is safe.

## Important Risks

A trusted MCP client with access to ChromeUse MCP can:

- Read visible page content and HTML.
- Capture screenshots.
- Click buttons and links.
- Type into forms.
- Upload local files explicitly passed to `file_upload`.
- Inspect console and network activity.
- Execute JavaScript in a page context.
- Operate on authenticated browser sessions.

Use caution on production admin panels, payment flows, private accounts, and pages containing sensitive data.

## Recommended Safe Usage

- Use a dedicated browser profile for automation when possible.
- Keep the extension unpacked only in browsers where you intend to use it.
- Only register extension IDs you recognize.
- Only configure trusted local MCP clients.
- Review tool calls before allowing agents to operate on sensitive pages.
- Prefer explicit `tabId` targeting.
- Avoid `javascript_tool` with code from untrusted sources.

## Network Exposure

The MCP server uses stdio and does not expose an HTTP server. The native host communicates with the MCP server through a local Unix domain socket. Do not wrap or expose this server over a network unless you add your own authentication and understand the risks.
