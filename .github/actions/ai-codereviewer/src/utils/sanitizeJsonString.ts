export function sanitizeJsonString(input: string): string {
  return (
    input
      // 移除 \xNN 格式的转义字符
      .replace(/\\x[0-9A-Fa-f]{2}/g, "")
      // 移除 \uNNNN 格式的非标准 Unicode 转义字符
      .replace(/\\u[0-9A-Fa-f]{4}/g, "")
      // 移除其他可能影响 JSON 解析的非标准控制字符
      .replace(/[\x00-\x1F\x7F]/g, "")
      // 替换 \\n、\\t 等符合 JSON 标准的字符
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\b/g, "\b")
      .replace(/\\f/g, "\f")
      // 移除反引号
      .replace(/`/g, "")
      // 移除多余的反斜杠（但保留 JSON 标准中的 \n, \t, \r, \b, \f）
      .replace(/\\(?!["\\/bfnrt])/g, "")
      // 替换单引号为双引号
      .replace(/'/g, '"')
  );
}
