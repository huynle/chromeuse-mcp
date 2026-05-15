import mermaid from "mermaid";

export async function renderMermaidDiagrams(doc: Document, diagrams: readonly HTMLElement[]): Promise<void> {
  if (!diagrams.length) return;

  mermaid.initialize({
    startOnLoad: false,
    theme: doc.body.classList.contains("chromeuse-theme-dark") ? "dark" : "default",
  });
  await mermaid.run({ nodes: [...diagrams] });
}
