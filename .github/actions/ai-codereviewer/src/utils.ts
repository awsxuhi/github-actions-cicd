import path from "path";

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
      // file = match[1]; //这个写法会包含完整路径，如/home/runner/work/github-actions-cicd/github-actions-cicd/.github/actions/aws-genai-codereview/src/review.ts
      file = path.basename(match[1]); // 使用 path.basename 只提取文件名，不包括路径，如review.ts
      line = match[2];
    }
  }

  // 打印颜色化的字符串和变量内容
  // 使用 console.dir 打印出对象的完整结构，比console.log好的地方是打印出来的对象的属性值含有颜色
  // depth: null：确保显示对象的所有嵌套层级，打印出完整的结构。
  // colors: true：让终端输出的结果带有颜色，方便阅读。
  console.log(`\n\n\x1b[36m%s\x1b[0m`, `Printing ${variableName} <${file}:${line}>`);
  console.dir(variableValue, { depth, colors });
}