import { describe, expect, it } from "vitest";
import { detectDocumentType } from "./documentTypes.js";

describe("detectDocumentType", () => {
  it("detects supported document families by file extension", () => {
    expect(detectDocumentType({ name: "README.md" }).kind).toBe("markdown");
    expect(detectDocumentType({ name: "manual.PDF" }).kind).toBe("pdf");
    expect(detectDocumentType({ name: "deck.pptx" }).kind).toBe("powerpoint");
    expect(detectDocumentType({ name: "budget.xlsx" }).kind).toBe("excel");
    expect(detectDocumentType({ name: "brief.docx" }).kind).toBe("word");
    expect(detectDocumentType({ name: "notes.txt" }).kind).toBe("text");
  });

  it("uses MIME type when extension is missing or ambiguous", () => {
    expect(detectDocumentType({ name: "download", mimeType: "application/pdf" }).kind).toBe("pdf");
    expect(detectDocumentType({ name: "download", mimeType: "text/markdown" }).kind).toBe("markdown");
    expect(
      detectDocumentType({
        name: "download",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }).kind,
    ).toBe("word");
  });

  it("surfaces binary and large-file constraints", () => {
    expect(detectDocumentType({ name: "archive.zip" }).kind).toBe("binary");

    const largeMarkdown = detectDocumentType({ name: "huge.md", sizeBytes: 6 * 1024 * 1024 });
    expect(largeMarkdown.kind).toBe("markdown");
    expect(largeMarkdown.isLarge).toBe(true);
    expect(largeMarkdown.constraints).toContain("large-file");

    const binaryPdf = detectDocumentType({ name: "signed.pdf", isBinary: true });
    expect(binaryPdf.kind).toBe("pdf");
    expect(binaryPdf.isBinary).toBe(true);
    expect(binaryPdf.constraints).toContain("binary-file");
  });

  it("returns unknown for unrecognized non-binary files", () => {
    const result = detectDocumentType({ name: "workspace.custom" });

    expect(result.kind).toBe("unknown");
    expect(result.label).toBe("Unknown file");
  });
});
