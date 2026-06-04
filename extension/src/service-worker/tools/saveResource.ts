/**
 * save_resource tool - downloads and saves resources from authenticated pages.
 *
 * Fetches a resource URL (using page credentials/cookies) and saves it to the local filesystem.
 * Supports all file types: images, PDFs, documents, archives, etc.
 *
 * Args:
 *   tabId (number, required): The tab to use for authentication context.
 *   url (string, required): The URL of the resource to download.
 *   outputPath (string, optional): Workspace-relative path where to save the file.
 *   filename (string, optional): Filename to use (extracted from URL if omitted).
 *
 * The tool uses fetch() in the page context to preserve authentication cookies,
 * then uses Chrome's downloads API to save the file.
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";
import { WorkspaceWriteTool } from "./workspaceWrite.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum file size to download (100 MB) */
const MAX_FILE_SIZE = 100 * 1024 * 1024;

/** Timeout for fetch operation (60 seconds) */
const FETCH_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FetchResult {
  success: boolean;
  dataUrl?: string;
  contentType?: string;
  size?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

export class SaveResourceTool implements ToolHandler {
  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    try {
      // --- Validate args ---
      const tabId = typeof args.tabId === "number" ? args.tabId : undefined;
      if (tabId === undefined) {
        return {
          success: false,
          content: [
            { type: "text", text: "Missing required argument: tabId (number)" },
          ],
        };
      }

      const url = typeof args.url === "string" ? args.url : undefined;
      if (!url) {
        return {
          success: false,
          content: [
            { type: "text", text: "Missing required argument: url (string)" },
          ],
        };
      }

      // Validate URL format
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return {
          success: false,
          content: [{ type: "text", text: `Invalid URL format: ${url}` }],
        };
      }

      const outputPath =
        typeof args.outputPath === "string" ? args.outputPath : undefined;
      if (outputPath && this.isAbsolutePath(outputPath)) {
        return {
          success: false,
          content: [
            {
              type: "text",
              text: "outputPath must be workspace-relative. Select a workspace in the side panel and pass a relative path, or omit outputPath to save to Downloads.",
            },
          ],
        };
      }
      const filename =
        typeof args.filename === "string" ? args.filename : undefined;

      // --- Fetch the resource in page context (preserves auth cookies) ---
      const fetchResult = await this.fetchResourceInPage(tabId, url);

      if (!fetchResult.success || !fetchResult.dataUrl) {
        return {
          success: false,
          content: [
            {
              type: "text",
              text: `Failed to fetch resource: ${fetchResult.error ?? "Unknown error"}`,
            },
          ],
        };
      }

      // --- Determine the filename ---
      const finalFilename =
        filename ?? this.extractFilenameFromUrl(parsedUrl) ?? "download";

      // --- Determine save location ---
      let savePath: string;
      if (outputPath) {
        // If outputPath is provided, use it
        if (outputPath.endsWith("/")) {
          // It's a directory, append filename
          savePath = outputPath + finalFilename;
        } else if (outputPath.includes("/")) {
          // It's a full path
          savePath = outputPath;
        } else {
          // It's just a relative filename
          savePath = outputPath;
        }
      } else {
        // Default to Downloads folder
        savePath = finalFilename;
      }

      // --- Try workspace FileSystem API first (truly silent) ---
      if (outputPath) {
        const workspaceWriter = new WorkspaceWriteTool();
        const workspaceResult = await workspaceWriter.execute(
          {
            path: outputPath.endsWith("/") ? outputPath + finalFilename : outputPath,
            dataUrl: fetchResult.dataUrl,
            createDirectories: true,
          },
          _context,
        );

        if (workspaceResult.success) {
          return workspaceResult;
        }
        // If workspace write failed, fall back to downloads API
      }

      // --- Fallback: Trigger Chrome download with hidden shelf ---
      // Suppress the download shelf (bottom bar) for cleaner automation
      chrome.downloads.setShelfEnabled(false);
      
      const downloadId = await this.triggerDownload(
        fetchResult.dataUrl,
        savePath,
        fetchResult.contentType,
      );

      // --- Wait for download to complete ---
      const downloadPath = await this.waitForDownload(downloadId);
      
      // Re-enable the download shelf
      chrome.downloads.setShelfEnabled(true);

      return {
        success: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                path: downloadPath,
                size: fetchResult.size,
                contentType: fetchResult.contentType,
                url: url,
                method: "downloads-api",
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      // Re-enable the download shelf in case of error
      try {
        chrome.downloads.setShelfEnabled(true);
      } catch {
        // Ignore if shelf control fails
      }
      
      return {
        success: false,
        content: [
          {
            type: "text",
            text: `Failed to save resource: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  /**
   * Fetches a resource in the page context using fetch() with credentials.
   * Returns the data as a data URL for download.
   */
  private async fetchResourceInPage(
    tabId: number,
    url: string,
  ): Promise<FetchResult> {
    try {
      // Inject a script to fetch the resource and convert to data URL
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: async (resourceUrl: string, maxSize: number, timeout: number) => {
          try {
            // Fetch with timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const response = await fetch(resourceUrl, {
              credentials: "include", // Include cookies for auth
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
              return {
                success: false,
                error: `HTTP ${response.status}: ${response.statusText}`,
              };
            }

            const contentType = response.headers.get("content-type") ?? undefined;
            const contentLength = response.headers.get("content-length");

            // Check size before downloading
            if (contentLength && parseInt(contentLength, 10) > maxSize) {
              return {
                success: false,
                error: `File too large: ${contentLength} bytes (max ${maxSize})`,
              };
            }

            // Get the blob
            const blob = await response.blob();

            if (blob.size > maxSize) {
              return {
                success: false,
                error: `File too large: ${blob.size} bytes (max ${maxSize})`,
              };
            }

            // Convert to data URL
            return new Promise<{
              success: boolean;
              dataUrl?: string;
              contentType?: string;
              size?: number;
              error?: string;
            }>((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                if (typeof reader.result === "string") {
                  resolve({
                    success: true,
                    dataUrl: reader.result,
                    contentType,
                    size: blob.size,
                  });
                } else {
                  resolve({
                    success: false,
                    error: "Failed to convert blob to data URL",
                  });
                }
              };
              reader.onerror = () => {
                resolve({
                  success: false,
                  error: "FileReader error",
                });
              };
              reader.readAsDataURL(blob);
            });
          } catch (error) {
            return {
              success: false,
              error:
                error instanceof Error ? error.message : "Unknown fetch error",
            };
          }
        },
        args: [url, MAX_FILE_SIZE, FETCH_TIMEOUT_MS],
      });

      if (!result || result.length === 0 || !result[0].result) {
        return {
          success: false,
          error: "Script execution failed",
        };
      }

      return result[0].result as FetchResult;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Script injection failed",
      };
    }
  }

  /**
   * Extracts filename from URL pathname or returns undefined.
   */
  private extractFilenameFromUrl(url: URL): string | undefined {
    const pathname = url.pathname;
    const segments = pathname.split("/").filter((s) => s.length > 0);

    if (segments.length === 0) {
      return undefined;
    }

    const lastSegment = segments[segments.length - 1];

    // Check if it looks like a filename (has an extension)
    if (lastSegment.includes(".")) {
      return lastSegment;
    }

    return undefined;
  }

  private isAbsolutePath(path: string): boolean {
    return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
  }

  /**
   * Triggers a Chrome download using the downloads API.
   * Returns the download ID.
   */
  private async triggerDownload(
    dataUrl: string,
    filename: string,
    contentType?: string,
  ): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      chrome.downloads.download(
        {
          url: dataUrl,
          filename: filename,
          saveAs: false, // Don't show save dialog
        },
        (downloadId) => {
          if (chrome.runtime.lastError) {
            reject(
              new Error(
                `Download failed: ${chrome.runtime.lastError.message}`,
              ),
            );
          } else if (downloadId === undefined) {
            reject(new Error("Download ID is undefined"));
          } else {
            resolve(downloadId);
          }
        },
      );
    });
  }

  /**
   * Waits for a download to complete and returns the final file path.
   */
  private async waitForDownload(downloadId: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.downloads.onChanged.removeListener(listener);
        reject(new Error("Download timeout"));
      }, 60_000); // 60 second timeout

      const listener = (delta: chrome.downloads.DownloadDelta) => {
        if (delta.id !== downloadId) return;

        if (delta.state?.current === "complete") {
          clearTimeout(timeout);
          chrome.downloads.onChanged.removeListener(listener);

          // Get the download item to retrieve the full path
          chrome.downloads.search({ id: downloadId }, (items) => {
            if (items.length > 0 && items[0].filename) {
              resolve(items[0].filename);
            } else {
              reject(new Error("Could not retrieve download path"));
            }
          });
        } else if (delta.state?.current === "interrupted") {
          clearTimeout(timeout);
          chrome.downloads.onChanged.removeListener(listener);
          reject(new Error(`Download interrupted`));
        }
      };

      chrome.downloads.onChanged.addListener(listener);

      // Check if already complete (race condition)
      chrome.downloads.search({ id: downloadId }, (items) => {
        if (items.length > 0 && items[0].state === "complete") {
          clearTimeout(timeout);
          chrome.downloads.onChanged.removeListener(listener);
          if (items[0].filename) {
            resolve(items[0].filename);
          } else {
            reject(new Error("Could not retrieve download path"));
          }
        }
      });
    });
  }
}
