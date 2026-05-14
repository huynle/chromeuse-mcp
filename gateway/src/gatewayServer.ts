import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { BrowserTransport, ToolRequestResult } from "@chromeuse/mcp-server";

const GATEWAY_IDENTITY = "chromeuse-http-gateway";
const GATEWAY_VERSION = "1.0.0";

export interface GatewayServerOptions {
  readonly transport: BrowserTransport;
  readonly clientId: string;
  readonly logger?: (message: string) => void;
}

interface ToolRequestBody {
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly timeoutMs?: number;
  readonly clientId?: string;
  readonly sessionScope?: string;
}

export function createGatewayServer(options: GatewayServerOptions): Server {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, {
        gateway: GATEWAY_IDENTITY,
        version: GATEWAY_VERSION,
        protocol: GATEWAY_IDENTITY,
        protocolVersion: GATEWAY_VERSION,
        client_id: options.clientId,
        extensionConnected: options.transport.connected,
      });
      return;
    }

    if (url.pathname === "/tool") {
      if (request.method !== "POST") {
        writeToolError(response, 405, "Method not allowed");
        return;
      }

      await handleToolRequest(request, response, options.transport, options.logger);
      return;
    }

    writeToolError(response, 404, "Not found");
  });
}

async function handleToolRequest(
  request: IncomingMessage,
  response: ServerResponse,
  transport: BrowserTransport,
  logger?: (message: string) => void
): Promise<void> {
  const start = Date.now();
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(await readRequestBody(request));
  } catch {
    logGateway(logger, "mode=SERVER event=request_end status=400 error=invalid_json");
    writeToolError(response, 400, "Invalid JSON request body");
    return;
  }

  const toolRequest = normalizeToolRequestBody(parsedBody);
  if (!toolRequest) {
    logGateway(logger, "mode=SERVER event=request_end status=400 error=invalid_body");
    writeToolError(response, 400, "Invalid tool request body");
    return;
  }

  logGateway(logger, `mode=SERVER event=request_start tool=${toolRequest.tool}`);

  if (!transport.connected) {
    logGateway(
      logger,
      `mode=SERVER event=request_end status=503 tool=${toolRequest.tool} duration_ms=${Date.now() - start}`
    );
    writeToolError(response, 503, "No extension connected");
    return;
  }

  try {
    const metadata = toolRequest.clientId || toolRequest.sessionScope
      ? { clientId: toolRequest.clientId, sessionScope: toolRequest.sessionScope }
      : undefined;
    const result = metadata
      ? await transport.sendToolRequest(
          toolRequest.tool,
          toolRequest.args,
          toolRequest.timeoutMs,
          metadata
        )
      : await transport.sendToolRequest(
          toolRequest.tool,
          toolRequest.args,
          toolRequest.timeoutMs
        );
    writeJson(response, 200, result);
    logGateway(
      logger,
      `mode=SERVER event=request_end status=200 tool=${toolRequest.tool} duration_ms=${Date.now() - start}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "No extension connected" ? 503 : 500;
    writeToolError(response, status, message);
    logGateway(
      logger,
      `mode=SERVER event=request_end status=${status} tool=${toolRequest.tool} duration_ms=${Date.now() - start}`
    );
  }
}

function logGateway(logger: ((message: string) => void) | undefined, message: string): void {
  logger?.(message);
}

function normalizeToolRequestBody(body: unknown): ToolRequestBody | null {
  if (!isRecord(body)) return null;

  const tool = body.tool ?? body.name;
  const args = body.args ?? body.arguments ?? {};
  const timeoutMs = body.timeoutMs;
  const clientId = body.client_id ?? body.clientId;
  const sessionScope = body.session_scope ?? body.sessionScope;

  if (typeof tool !== "string" || tool.length === 0) return null;
  if (!isRecord(args)) return null;
  if (timeoutMs !== undefined && typeof timeoutMs !== "number") return null;
  if (clientId !== undefined && typeof clientId !== "string") return null;
  if (sessionScope !== undefined && typeof sessionScope !== "string") return null;

  return { tool, args, timeoutMs, clientId, sessionScope };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function writeToolError(response: ServerResponse, status: number, message: string): void {
  writeJson(response, status, toToolError(message));
}

function toToolError(message: string): ToolRequestResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
