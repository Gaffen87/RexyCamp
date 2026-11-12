const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const ELLIPSIS = "…";

export function displayWidth(text: string): number {
  return Bun.stringWidth(text);
}

export function truncateToWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (displayWidth(text) <= maxWidth) return text;
  let truncated = "";
  let truncatedWidth = 0;
  for (const { segment } of graphemeSegmenter.segment(text)) {
    const segmentWidth = displayWidth(segment);
    if (truncatedWidth + segmentWidth > maxWidth - 1) break;
    truncated += segment;
    truncatedWidth += segmentWidth;
  }
  return truncated + ELLIPSIS;
}

export function fitToWidth(text: string, width: number): string {
  const truncated = truncateToWidth(text, width);
  return truncated + " ".repeat(Math.max(0, width - displayWidth(truncated)));
}

function breakLongWord(word: string, width: number): string[] {
  const pieces: string[] = [];
  let piece = "";
  let pieceWidth = 0;
  for (const { segment } of graphemeSegmenter.segment(word)) {
    const segmentWidth = displayWidth(segment);
    if (pieceWidth + segmentWidth > width && piece !== "") {
      pieces.push(piece);
      piece = "";
      pieceWidth = 0;
    }
    piece += segment;
    pieceWidth += segmentWidth;
  }
  if (piece !== "") pieces.push(piece);
  return pieces;
}

export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [];
  const wrappedLines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const indent = paragraph.match(/^\s*/)?.[0] ?? "";
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      for (const piece of breakLongWord(word, Math.max(1, width - displayWidth(indent)))) {
        const candidate = line === "" ? indent + piece : `${line} ${piece}`;
        if (displayWidth(candidate) <= width) {
          line = candidate;
        } else {
          wrappedLines.push(line);
          line = indent + piece;
        }
      }
    }
    wrappedLines.push(line);
  }
  return wrappedLines;
}

const HTML_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(parseInt(name.slice(1), 10));
    return HTML_ENTITIES[name.toLowerCase()] ?? entity;
  });
}

export function htmlToText(html: string): string {
  const withLineBreaks = html
    .replace(/\r/g, "")
    .replace(/<bc-attachment\b([^>]*)>[\s\S]*?<\/bc-attachment>/gi, (_match, attributes: string) => {
      const attributeValue = (name: string) => attributes.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1];
      return `[${attributeValue("caption") ?? attributeValue("filename") ?? "attachment"}]`;
    })
    .replace(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, label: string) => {
      const labelText = label.replace(/<[^>]+>/g, "").trim();
      return labelText === "" || labelText === href ? href : `${labelText} (${href})`;
    })
    .replace(/<li\b[^>]*>/gi, "\n  • ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|ul|ol|blockquote|pre|tr)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(withLineBreaks)
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
