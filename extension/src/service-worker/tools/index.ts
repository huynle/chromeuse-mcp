/**
 * Tool registry - imports all tool handlers and registers them with the
 * message router using shared TOOL_NAMES constants.
 *
 * Called once during service worker initialization.
 */

import { TOOL_NAMES } from "@chromeuse/shared";
import type { MessageRouter } from "../messageRouter.js";

// Tool handlers
import { ComputerTool } from "./computer.js";
import { ConsoleTool } from "./console.js";
import { FileUploadTool } from "./fileUpload.js";
import { FindTool } from "./find.js";
import { FormInputTool } from "./formInput.js";
import { GetPageTextTool } from "./getPageText.js";
import { GifCreatorTool } from "./gifCreator.js";
import { HealthCheckTool } from "./healthCheck.js";
import { JavaScriptTool } from "./javascript.js";
import { MarkdownRenderTool } from "./markdownRender.js";
import { NavigateTool } from "./navigate.js";
import { NetworkTool } from "./network.js";
import { ReadPageTool } from "./readPage.js";
import { ResizeTool } from "./resize.js";
import { SaveResourceTool } from "./saveResource.js";
import { TabsCloseTool } from "./tabsClose.js";
import { TabsContextTool } from "./tabsContext.js";
import { TabsCreateTool } from "./tabsCreate.js";
import { WorkspaceListTool } from "./workspaceList.js";
import { WorkspaceReadTool } from "./workspaceRead.js";
import { WorkspaceWriteTool } from "./workspaceWrite.js";
import { WaitForTool } from "./waitFor.js";
import { NetworkInterceptTool } from "./networkIntercept.js";
import { CookiesTool } from "./cookies.js";
import { StorageTool } from "./storage.js";
import { EmulateTool } from "./emulate.js";
import { PerformanceMetricsTool } from "./performanceMetrics.js";
import { ScreenshotElementTool } from "./screenshotElement.js";
import { PrintToPdfTool } from "./printToPdf.js";
import { ExtractStructuredTool } from "./extractStructured.js";
import { TabSessionTool } from "./tabSession.js";
import { HistorySearchTool } from "./historySearch.js";
import { BookmarksTool } from "./bookmarks.js";
import { CoverageTool } from "./coverage.js";

/**
 * Register all tool handlers with the message router.
 *
 * Each handler implements {@link ToolHandler} and is registered under its
 * canonical name from {@link TOOL_NAMES}.
 */
export function registerTools(router: MessageRouter): void {
  router.register(TOOL_NAMES.COMPUTER, new ComputerTool());
  router.register(TOOL_NAMES.READ_CONSOLE, new ConsoleTool());
  router.register(TOOL_NAMES.FILE_UPLOAD, new FileUploadTool());
  router.register(TOOL_NAMES.FIND, new FindTool());
  router.register(TOOL_NAMES.FORM_INPUT, new FormInputTool());
  router.register(TOOL_NAMES.GET_PAGE_TEXT, new GetPageTextTool());
  router.register(TOOL_NAMES.GIF_CREATOR, new GifCreatorTool());
  router.register(TOOL_NAMES.HEALTH_CHECK, new HealthCheckTool());
  router.register(TOOL_NAMES.JAVASCRIPT, new JavaScriptTool());
  router.register(TOOL_NAMES.MARKDOWN_RENDER, new MarkdownRenderTool());
  router.register(TOOL_NAMES.NAVIGATE, new NavigateTool());
  router.register(TOOL_NAMES.READ_NETWORK, new NetworkTool());
  router.register(TOOL_NAMES.READ_PAGE, new ReadPageTool());
  router.register(TOOL_NAMES.RESIZE_WINDOW, new ResizeTool());
  router.register(TOOL_NAMES.SAVE_RESOURCE, new SaveResourceTool());
  router.register(TOOL_NAMES.TABS_CLOSE, new TabsCloseTool());
  router.register(TOOL_NAMES.TABS_CONTEXT, new TabsContextTool());
  router.register(TOOL_NAMES.TABS_CREATE, new TabsCreateTool());
  router.register(TOOL_NAMES.WORKSPACE_LIST_FILES, new WorkspaceListTool());
  router.register(TOOL_NAMES.WORKSPACE_READ_FILE, new WorkspaceReadTool());
  router.register(TOOL_NAMES.WORKSPACE_WRITE_FILE, new WorkspaceWriteTool());
  router.register(TOOL_NAMES.WAIT_FOR, new WaitForTool());
  router.register(TOOL_NAMES.NETWORK_INTERCEPT, new NetworkInterceptTool());
  router.register(TOOL_NAMES.COOKIES, new CookiesTool());
  router.register(TOOL_NAMES.STORAGE, new StorageTool());
  router.register(TOOL_NAMES.EMULATE, new EmulateTool());
  router.register(TOOL_NAMES.PERFORMANCE_METRICS, new PerformanceMetricsTool());
  router.register(TOOL_NAMES.SCREENSHOT_ELEMENT, new ScreenshotElementTool());
  router.register(TOOL_NAMES.PRINT_TO_PDF, new PrintToPdfTool());
  router.register(TOOL_NAMES.EXTRACT_STRUCTURED, new ExtractStructuredTool());
  router.register(TOOL_NAMES.TAB_SESSION, new TabSessionTool());
  router.register(TOOL_NAMES.HISTORY_SEARCH, new HistorySearchTool());
  router.register(TOOL_NAMES.BOOKMARKS, new BookmarksTool());
  router.register(TOOL_NAMES.COVERAGE, new CoverageTool());

  console.log(
    "[Tools] Registered:",
    router.getRegisteredTools().join(", "),
  );
}
