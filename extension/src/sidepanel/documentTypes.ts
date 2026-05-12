export type DocumentKind =
  | "markdown"
  | "pdf"
  | "powerpoint"
  | "excel"
  | "word"
  | "text"
  | "binary"
  | "unknown";

export interface DocumentDescriptor {
  readonly name: string;
  readonly mimeType?: string;
  readonly sizeBytes?: number;
  readonly isBinary?: boolean;
}

export interface DocumentTypeInfo {
  readonly kind: DocumentKind;
  readonly label: string;
  readonly isBinary: boolean;
  readonly isLarge: boolean;
  readonly constraints: readonly string[];
}

const LARGE_FILE_THRESHOLD_BYTES = 5 * 1024 * 1024;

const EXTENSION_TYPES: Record<string, DocumentKind> = {
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  pdf: "pdf",
  ppt: "powerpoint",
  pptx: "powerpoint",
  xls: "excel",
  xlsx: "excel",
  csv: "text",
  doc: "word",
  docx: "word",
  rtf: "word",
  txt: "text",
  text: "text",
  log: "text",
  json: "text",
  xml: "text",
  yaml: "text",
  yml: "text",
  zip: "binary",
  gz: "binary",
  tar: "binary",
  png: "binary",
  jpg: "binary",
  jpeg: "binary",
  gif: "binary",
  webp: "binary",
  exe: "binary",
  dmg: "binary",
};

const MIME_TYPES: Record<string, DocumentKind> = {
  "text/markdown": "markdown",
  "text/x-markdown": "markdown",
  "application/pdf": "pdf",
  "application/vnd.ms-powerpoint": "powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "powerpoint",
  "application/vnd.ms-excel": "excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "excel",
  "application/msword": "word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "word",
  "application/rtf": "word",
  "application/zip": "binary",
  "application/gzip": "binary",
  "application/octet-stream": "binary",
};

const LABELS: Record<DocumentKind, string> = {
  markdown: "Markdown",
  pdf: "PDF",
  powerpoint: "PowerPoint presentation",
  excel: "Excel spreadsheet",
  word: "Word document",
  text: "Text file",
  binary: "Binary file",
  unknown: "Unknown file",
};

function extensionFor(name: string): string {
  const lastSegment = name.split(/[\\/]/).pop() ?? name;
  const dotIndex = lastSegment.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === lastSegment.length - 1) return "";
  return lastSegment.slice(dotIndex + 1).toLowerCase();
}

function kindFromMimeType(mimeType?: string): DocumentKind | undefined {
  if (!mimeType) return undefined;
  const normalized = mimeType.split(";", 1)[0].trim().toLowerCase();
  if (normalized.startsWith("text/")) return MIME_TYPES[normalized] ?? "text";
  return MIME_TYPES[normalized];
}

export function detectDocumentType(document: DocumentDescriptor): DocumentTypeInfo {
  const extension = extensionFor(document.name);
  const kind = EXTENSION_TYPES[extension] ?? kindFromMimeType(document.mimeType) ?? "unknown";
  const isLarge = typeof document.sizeBytes === "number" && document.sizeBytes > LARGE_FILE_THRESHOLD_BYTES;
  const isBinary = document.isBinary === true || kind === "binary";
  const constraints: string[] = [];
  if (isLarge) constraints.push("large-file");
  if (isBinary) constraints.push("binary-file");

  return {
    kind,
    label: LABELS[kind],
    isBinary,
    isLarge,
    constraints,
  };
}
