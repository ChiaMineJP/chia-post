import katex from "katex";

/** Inline (or display) math rendered with KaTeX. `expr` is a LaTeX string. */
export function Tex({ expr, block = false }: { expr: string; block?: boolean }) {
  const html = katex.renderToString(expr, { throwOnError: false, displayMode: block, output: "html" });
  return (
    <span
      className="tex"
      style={block ? { display: "block", margin: "7px 0", overflowX: "auto" } : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
