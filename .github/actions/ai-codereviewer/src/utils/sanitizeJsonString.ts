export function sanitizeJsonString(input: string): string {
  return (
    input
      // 移除非标准的转义字符，例如 \xNN 格式
      .replace(/\\x[0-9A-Fa-f]{2}/g, "")
      // 移除 Unicode 转义字符，例如 \uNNNN 格式（不符合 JSON 标准的）
      .replace(/\\u[0-9A-Fa-f]{4}/g, "")
      // 移除控制字符（ASCII 0-31），它们通常不出现在 JSON 字符串中
      .replace(/[\x00-\x1F\x7F]/g, "")
      // 移除反引号（`），这些符号不属于 JSON 标准
      .replace(/`/g, "")
      // 移除多余的反斜杠，但保留 JSON 标准中的 \n, \t, \r, \b, \f
      .replace(/\\(?!["\\/bfnrt])/g, "")
      // 替换单引号为双引号（如果有的话）
      .replace(/'/g, '"')
  );
}
