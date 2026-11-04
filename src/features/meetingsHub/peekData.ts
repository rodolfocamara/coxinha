/** The opening lines of a Markdown note, without frontmatter or markup. */
export function noteLines(markdown: string, count = 5): string[] {
  const close = markdown.startsWith('---\n') ? markdown.indexOf('\n---', 3) : -1;
  const body = close < 0 ? markdown : markdown.slice(close + 4);
  return body
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*#{1,6}\s+/, '')
        .replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/, '• ')
        .replace(/\*\*|__|`/g, '')
        .trim()
    )
    .filter(Boolean)
    .slice(0, count);
}
