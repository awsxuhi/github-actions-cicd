export function sanitizeJsonString(input: string): string {
  return (
    input
      // 移除非标准的转义字符，例如 \xNN 格式
      .replace(/\\x[0-9A-Fa-f]{2}/g, "")
      // 移除非标准的 Unicode 转义字符，例如 \uNNNN 格式
      .replace(/\\u[0-9A-Fa-f]{4}/g, "")
      // 移除控制字符（ASCII 0-31 和 127），这些字符通常不出现在 JSON 字符串中
      .replace(/[\x00-\x1F\x7F]/g, "")
      // 保留 JSON 标准转义字符
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\b/g, "\b")
      .replace(/\\f/g, "\f")
      // 移除反引号
      .replace(/`/g, "")
      // 移除多余的反斜杠（但保留 JSON 标准中的 \n, \t, \r, \b, \f）
      .replace(/\\(?!["\\/bfnrt])/g, "")
    // 保持单引号和双引号不变，不再替换单引号
  );
}
