declare module 'marked-terminal' {
  import { MarkedExtension } from 'marked';

  interface TableOptions {
    chars?: Record<string, string>;
    style?: { head?: string[] };
  }

  interface TerminalRendererOptions {
    reflowText?: boolean;
    width?: number;
    tableOptions?: TableOptions;
  }

  export function markedTerminal(
    options?: TerminalRendererOptions,
    highlightOptions?: unknown
  ): MarkedExtension;
}
