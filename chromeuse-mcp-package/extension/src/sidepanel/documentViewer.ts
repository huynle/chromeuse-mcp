import { detectDocumentType, type DocumentDescriptor, type DocumentKind } from "./documentTypes.js";
import { renderMarkdown } from "./markdownRenderer.js";

export interface DocumentViewerModel {
  readonly viewer: "markdown-preview" | "placeholder";
  readonly title: string;
  readonly kind: DocumentKind;
  readonly label: string;
  readonly message: string;
  readonly bodyHtml: string;
  readonly constraints: readonly string[];
}

export interface WorkspaceDocument extends DocumentDescriptor {
  readonly contentText?: string;
}

const VIEWER_MESSAGES: Record<DocumentKind, string> = {
  markdown: "Markdown preview is available. Full review/edit support is future work.",
  pdf: "PDF full review/edit support is future work.",
  powerpoint: "PowerPoint full review/edit support is future work.",
  excel: "Excel full review/edit support is future work.",
  word: "Word full review/edit support is future work.",
  text: "Text file full review/edit support is future work.",
  binary: "Binary file full review/edit support is future work.",
  unknown: "Unknown file full review/edit support is future work.",
};

function constraintMessages(constraints: readonly string[]): string[] {
  return constraints.map((constraint) => {
    switch (constraint) {
      case "binary-file":
        return "Binary files cannot be previewed in the workspace yet.";
      case "large-file":
        return "Large file preview is limited to protect side panel performance.";
      default:
        return constraint;
    }
  });
}

export function createDocumentViewerModel(document: WorkspaceDocument): DocumentViewerModel {
  const documentType = detectDocumentType(document);
  const constraints = constraintMessages(documentType.constraints);
  const viewer =
    documentType.kind === "markdown" && !documentType.isLarge && !documentType.isBinary
      ? "markdown-preview"
      : "placeholder";

  return {
    viewer,
    title: document.name,
    kind: documentType.kind,
    label: documentType.label,
    message: VIEWER_MESSAGES[documentType.kind],
    bodyHtml: viewer === "markdown-preview" ? renderMarkdown(document.contentText ?? "") : "",
    constraints,
  };
}

export function renderDocumentViewer(container: HTMLElement, document: WorkspaceDocument): void {
  const model = createDocumentViewerModel(document);
  container.replaceChildren();

  const shell = container.ownerDocument.createElement("article");
  shell.className = `document-viewer document-viewer-${model.viewer}`;

  const header = container.ownerDocument.createElement("header");
  header.className = "document-viewer-header";

  const title = container.ownerDocument.createElement("h2");
  title.textContent = model.title;

  const type = container.ownerDocument.createElement("span");
  type.className = "document-viewer-type";
  type.textContent = model.label;

  header.append(title, type);
  shell.append(header);

  if (model.viewer === "markdown-preview") {
    const preview = container.ownerDocument.createElement("div");
    preview.className = "markdown-preview";
    preview.innerHTML = model.bodyHtml;
    shell.append(preview);
  } else {
    const placeholder = container.ownerDocument.createElement("div");
    placeholder.className = "document-placeholder";

    const message = container.ownerDocument.createElement("p");
    message.textContent = model.message;
    placeholder.append(message);

    if (model.constraints.length > 0) {
      const list = container.ownerDocument.createElement("ul");
      list.className = "document-constraints";
      for (const constraint of model.constraints) {
        const item = container.ownerDocument.createElement("li");
        item.textContent = constraint;
        list.append(item);
      }
      placeholder.append(list);
    }

    shell.append(placeholder);
  }

  container.append(shell);
}
