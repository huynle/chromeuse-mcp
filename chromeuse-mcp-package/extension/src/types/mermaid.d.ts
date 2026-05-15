declare module 'mermaid' {
  export interface MermaidConfig {
    startOnLoad?: boolean;
    theme?: string | 'default' | 'dark' | 'forest' | 'neutral';
    [key: string]: any;
  }

  export interface RunOptions {
    nodes?: ArrayLike<Element>;
    [key: string]: any;
  }

  export interface Mermaid {
    initialize(config: MermaidConfig): void;
    run(options?: RunOptions): Promise<void>;
    [key: string]: any;
  }

  const mermaid: Mermaid;
  export default mermaid;
}
