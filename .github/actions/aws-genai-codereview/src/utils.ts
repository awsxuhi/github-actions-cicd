export function printWithColor(variableName: string, variableValue: unknown, depth: number | null = null, colors: boolean = true): void {
  // 获取调用者的文件名和行号
  const error = new Error();
  const stack = error.stack;

  let file = "unknown file";
  let line = "unknown line";

  if (stack) {
    const callerLine = stack.split("\n")[2]; // 获取调用栈的第二行
    const regex = /\((.*?):(\d+):\d+\)/; // 匹配文件名和行号
    const match = regex.exec(callerLine);
    if (match) {
      file = match[1];
      line = match[2];
    }
  }

  // 打印颜色化的字符串和变量内容
  console.log(`\n\n\x1b[36m%s\x1b[0m`, `Printing ${variableName}... (${file}:${line})`);
  console.dir(variableValue, { depth, colors });
}
