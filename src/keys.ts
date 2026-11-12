const ESCAPE = "\x1b";

const CONTROL_KEYS: Record<string, string> = {
  "\r": "enter",
  "\n": "enter",
  "\t": "tab",
  "\x7f": "backspace",
  "\b": "backspace",
  "\x03": "ctrl+c",
  "\x04": "ctrl+d",
  "\x15": "ctrl+u",
};

const CURSOR_KEYS: Record<string, string> = {
  A: "up", B: "down", C: "right", D: "left", H: "home", F: "end", Z: "shift+tab",
};

const TILDE_KEYS: Record<string, string> = {
  "1": "home", "4": "end", "5": "pageup", "6": "pagedown", "7": "home", "8": "end",
};

// A terminal sends one chunk per key press, but several keys can arrive together.
export function parseKeys(chunk: string): string[] {
  const keys: string[] = [];
  let position = 0;
  while (position < chunk.length) {
    const rest = chunk.slice(position);
    const sequence = rest.match(/^\x1b(?:\[([0-9;]*)([A-Za-z~])|O([A-Za-z]))/);
    if (sequence) {
      const [matched, parameters, finalCharacter, singleShiftCharacter] = sequence;
      const key = singleShiftCharacter
        ? CURSOR_KEYS[singleShiftCharacter]
        : finalCharacter === "~"
          ? TILDE_KEYS[(parameters ?? "").split(";")[0] ?? ""]
          : CURSOR_KEYS[finalCharacter ?? ""];
      if (key) keys.push(key);
      position += matched.length;
      continue;
    }
    const character = String.fromCodePoint(rest.codePointAt(0) ?? 0);
    position += character.length;
    if (character === ESCAPE) keys.push("escape");
    else if (CONTROL_KEYS[character]) keys.push(CONTROL_KEYS[character]);
    else if (character >= " ") keys.push(character);
  }
  return keys;
}
