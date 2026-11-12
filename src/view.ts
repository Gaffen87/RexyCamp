import { displayWidth, fitToWidth, truncateToWidth } from "./text.ts";

export const SGR = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  selected: "\x1b[1;97;44m",
};

export function styled(text: string, ...codes: string[]): string {
  return codes.length === 0 ? text : codes.join("") + text + SGR.reset;
}

export interface Panel {
  number: number;
  title: string;
  // Every line is already styled and exactly as wide as the panel's inside.
  lines: string[];
  isFocused: boolean;
  footer?: string;
}

export function innerSize(width: number, height: number): { width: number; height: number } {
  return { width: Math.max(0, width - 2), height: Math.max(0, height - 2) };
}

export function drawPanel(panel: Panel, width: number, height: number): string[] {
  const inner = innerSize(width, height);
  const borderCodes = panel.isFocused ? [SGR.bold, SGR.green] : [];
  const border = (text: string) => styled(text, ...borderCodes);

  const heading = truncateToWidth(`[${panel.number}]─${panel.title}`, Math.max(0, inner.width - 1));
  const topFill = "─".repeat(Math.max(0, inner.width - 1 - displayWidth(heading)));
  const footer = truncateToWidth(panel.footer ?? "", Math.max(0, inner.width - 1));
  const bottomFill = "─".repeat(Math.max(0, inner.width - 1 - displayWidth(footer)));

  const blankLine = " ".repeat(inner.width);
  const bodyLines = Array.from({ length: inner.height }, (_unused, lineIndex) =>
    border("│") + (panel.lines[lineIndex] ?? blankLine) + border("│"));

  return [
    border(`╭─${heading}${topFill}╮`),
    ...bodyLines,
    border(`╰${bottomFill}${footer}─╯`),
  ];
}

export interface KeyHint {
  key: string;
  action: string;
}

export function drawKeyHints(keyHints: KeyHint[], width: number): string {
  let line = "";
  let lineWidth = 0;
  for (const keyHint of keyHints) {
    const separatorWidth = lineWidth === 0 ? 1 : 3;
    const hintWidth = displayWidth(keyHint.key) + 1 + displayWidth(keyHint.action);
    if (lineWidth + separatorWidth + hintWidth > width) break;
    line += (lineWidth === 0 ? " " : styled(" │ ", SGR.dim)) + styled(keyHint.key, SGR.bold, SGR.cyan) + " " + keyHint.action;
    lineWidth += separatorWidth + hintWidth;
  }
  return line + " ".repeat(Math.max(0, width - lineWidth));
}

export function drawStatus(text: string, isError: boolean, width: number): string {
  return styled(fitToWidth(` ${text}`, width), SGR.bold, isError ? SGR.red : SGR.green);
}

// Returns the scroll offset that keeps the cursor inside a window of the given height.
export function scrollToShow(cursorIndex: number, scrollTop: number, windowHeight: number, itemCount: number): number {
  if (windowHeight <= 0) return 0;
  let adjustedScrollTop = scrollTop;
  if (cursorIndex < adjustedScrollTop) adjustedScrollTop = cursorIndex;
  if (cursorIndex >= adjustedScrollTop + windowHeight) adjustedScrollTop = cursorIndex - windowHeight + 1;
  return Math.max(0, Math.min(adjustedScrollTop, Math.max(0, itemCount - windowHeight)));
}
