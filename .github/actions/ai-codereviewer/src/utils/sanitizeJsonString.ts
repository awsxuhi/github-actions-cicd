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

// export function sanitizeJsonString(input: string): string {
//   return input.replace(/"((?:[^"\\]|\\.|[\r\n])*?)"/g, (match, p1) => {
//     const fixed = p1
//       // Escape backslashes
//       .replace(/\\/g, "\\\\")
//       // Escape double quotes
//       .replace(/"/g, '\\"')
//       // Replace control characters with their Unicode escape sequences
//       .replace(/[\b]/g, "\\b")
//       .replace(/\f/g, "\\f")
//       .replace(/\n/g, "\\n")
//       .replace(/\r/g, "\\r")
//       .replace(/\t/g, "\\t")
//       // Remove non-standard escape sequences like \xNN or \uNNNN
//       .replace(/\\x[0-9A-Fa-f]{2}/g, "")
//       .replace(/\\u[0-9A-Fa-f]{4}/g, "")
//       // Remove other control characters (ASCII codes 0-31 and 127)
//       .replace(/[\x00-\x1F\x7F]/g, "")
//       // Remove backticks
//       .replace(/`/g, "")
//       // Remove any remaining invalid escape sequences
//       .replace(/\\(?!["\\/bfnrt])/g, "");
//     return `"${fixed}"`;
//   });
// }
