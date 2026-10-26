export type Segment = { kind: "text"; text: string } | { kind: "code"; text: string; lang: string | null };

/**
 * Splits markdown into prose and fenced code blocks, so the blocks can be rendered with a copy button and the rest by
 * the host's markdown renderer. An unclosed fence runs to the end. Fences may be ``` or ~~~, with an optional language.
 */
export function splitFences(markdown: string): Segment[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: Segment[] = [];
  let prose: string[] = [];
  let code: string[] | null = null;
  let fence = "";
  let lang: string | null = null;
  const flushProse = () => {
    const text = prose.join("\n").trim();
    if (text) out.push({ kind: "text", text });
    prose = [];
  };
  for (const line of lines) {
    if (code === null) {
      const open = /^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/.exec(line);
      if (open) {
        flushProse();
        code = [];
        fence = open[1][0].repeat(open[1].length);
        lang = open[2] || null;
      } else prose.push(line);
    } else if (new RegExp(`^\\s*${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`).test(line)) {
      out.push({ kind: "code", text: code.join("\n"), lang });
      code = null;
    } else code.push(line);
  }
  if (code !== null) out.push({ kind: "code", text: code.join("\n"), lang });
  flushProse();
  return out;
}
