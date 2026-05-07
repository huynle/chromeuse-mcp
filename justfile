set shell := ["sh", "-uc"]
version := `node -p "require('./package.json').version"`

# Show available recipes.
default:
    @just --list

# Install dependencies, build packages, and install native host manifests.
install *ARGS:
    ./scripts/install.sh {{ARGS}}

# Register the loaded unpacked extension ID with native messaging.
register extension_id:
    ./scripts/install.sh --extension-id={{extension_id}}

# Start extension watch mode for local development.
dev:
    ./scripts/dev.sh

# Remove build and release outputs.
clean:
    npm run clean
    rm -rf release

# Typecheck packages that expose typecheck scripts.
typecheck:
    npm run typecheck

# Run all workspace tests.
test:
    npm test

# Build all workspaces, including extension typecheck.
build:
    ./scripts/build.sh

# Check dependency advisories at moderate severity or higher.
audit:
    npm audit --audit-level=moderate

# Fast local confidence check for quick iteration.
quick: typecheck build

# Full local verification before pushing or cutting a release artifact.
verify: typecheck test build audit

# Build local artifacts for quick manual testing without running the full test suite.
quick-release: clean build
    mkdir -p release release-extension
    cp extension/manifest.json release-extension/
    cp extension/sidepanel.html release-extension/
    cp extension/sidepanel.css release-extension/
    cp -R extension/assets release-extension/assets
    cp -R extension/dist release-extension/dist
    (cd release-extension && zip -qr "../release/chromeuse-mcp-extension-v{{version}}.zip" .)
    rm -rf release-extension
    npm pack --workspace @chromeuse/shared --pack-destination release
    npm pack --workspace @chromeuse/native-host --pack-destination release
    npm pack --workspace @chromeuse/mcp-server --pack-destination release
    shasum -a 256 release/* > release/SHA256SUMS
    @printf '\nRelease artifacts written to release/\n'

# Full verified local release artifact build.
release: verify quick-release

# Print the unpacked extension directory to load in chrome://extensions.
extension-path:
    @pwd | sed 's#$#/extension#'

# Print the MCP server entry point for client configuration.
mcp-path:
    @pwd | sed 's#$#/mcp-server/dist/index.js#'
