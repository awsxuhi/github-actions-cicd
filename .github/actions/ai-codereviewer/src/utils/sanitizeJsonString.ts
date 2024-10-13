export function sanitizeJsonString(input: string): string {
  // Regular expression to match JSON string literals
  return input.replace(/"(?:[^"\\\n\r]|\\.)*"/gs, (match) => {
    // Extract the string content without the surrounding quotes
    const content = match.slice(1, -1);
    let fixedContent = "";
    for (let i = 0; i < content.length; i++) {
      const c = content[i];
      if (c === "\\") {
        // Keep existing escape sequences
        fixedContent += c;
        i++;
        if (i < content.length) {
          fixedContent += content[i];
        }
      } else if (c >= "\u0000" && c <= "\u001F") {
        // Escape unescaped control characters
        switch (c) {
          case "\b":
            fixedContent += "\\b";
            break;
          case "\f":
            fixedContent += "\\f";
            break;
          case "\n":
            fixedContent += "\\n";
            break;
          case "\r":
            fixedContent += "\\r";
            break;
          case "\t":
            fixedContent += "\\t";
            break;
          default:
            // For other control characters, use Unicode escape sequence
            fixedContent += "\\u" + ("000" + c.charCodeAt(0).toString(16)).slice(-4);
            break;
        }
      } else {
        fixedContent += c;
      }
    }
    // Return the sanitized string with the original quotes
    return `"${fixedContent}"`;
  });
}
