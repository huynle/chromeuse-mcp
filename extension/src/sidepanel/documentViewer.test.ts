import { describe, expect, it } from "vitest";
import { createDocumentViewerModel } from "./documentViewer.js";

describe("createDocumentViewerModel", () => {
  it("routes markdown documents to a markdown preview shell", () => {
    const model = createDocumentViewerModel({
      name: "README.md",
      contentText: "# Workspace\n\nHello",
    });

    expect(model.viewer).toBe("markdown-preview");
    expect(model.title).toBe("README.md");
    expect(model.bodyHtml).toContain("<h1>Workspace</h1>");
  });

  it("routes office, PDF, and unknown documents to future-work placeholders", () => {
    for (const name of ["guide.pdf", "deck.pptx", "budget.xlsx", "brief.docx", "shape.custom"]) {
      const model = createDocumentViewerModel({ name });

      expect(model.viewer).toBe("placeholder");
      expect(model.message).toContain("future work");
      expect(model.message).toContain("full review/edit support");
    }
  });

  it("surfaces binary and large-file constraints in placeholder shells", () => {
    const binary = createDocumentViewerModel({ name: "archive.zip" });
    expect(binary.viewer).toBe("placeholder");
    expect(binary.constraints).toContain("Binary files cannot be previewed in the workspace yet.");

    const binaryMarkdown = createDocumentViewerModel({ name: "README.md", isBinary: true });
    expect(binaryMarkdown.viewer).toBe("placeholder");
    expect(binaryMarkdown.constraints).toContain("Binary files cannot be previewed in the workspace yet.");

    const largePdf = createDocumentViewerModel({ name: "manual.pdf", sizeBytes: 8 * 1024 * 1024 });
    expect(largePdf.viewer).toBe("placeholder");
    expect(largePdf.constraints).toContain("Large file preview is limited to protect side panel performance.");
  });
});
