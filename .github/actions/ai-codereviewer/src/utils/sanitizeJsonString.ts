export function sanitizeJsonString(input: string): string {
  return input.replace(/"((?:[^"\\]|\\.|[\r\n])*?)"/g, (match, p1) => {
    const fixed = p1
      // Escape backslashes
      .replace(/\\/g, "\\\\")
      // Escape double quotes
      .replace(/"/g, '\\"')
      // Replace control characters with their Unicode escape sequences
      .replace(/[\b]/g, "\\b")
      .replace(/\f/g, "\\f")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t")
      // Remove non-standard escape sequences like \xNN or \uNNNN
      .replace(/\\x[0-9A-Fa-f]{2}/g, "")
      .replace(/\\u[0-9A-Fa-f]{4}/g, "")
      // Remove other control characters (ASCII codes 0-31 and 127)
      .replace(/[\x00-\x1F\x7F]/g, "")
      // Remove backticks
      .replace(/`/g, "")
      // Remove any remaining invalid escape sequences
      .replace(/\\(?!["\\/bfnrt])/g, "");
    return `"${fixed}"`;
  });
}
