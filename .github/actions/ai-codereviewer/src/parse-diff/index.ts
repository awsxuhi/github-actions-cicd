import { info, warning } from "@actions/core";

interface ChunkChange {
  type: string;
  normal?: boolean;
  del?: boolean;
  add?: boolean;
  ln?: number;
  ln1?: number;
  ln2?: number;
  content: string;
}

interface Chunk {
  content: string;
  changes: ChunkChange[];
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

interface FileDiff {
  chunks: Chunk[];
  deletions: number;
  additions: number;
  from: string;
  to: string;
  new?: boolean;
  deleted?: boolean;
  oldMode?: string;
  newMode?: string;
  index?: string[];
}

export function parseDiff(input: string): FileDiff[] {
  if (!input) return [];
  if (typeof input !== "string" || input.match(/^\s+$/)) return [];

  const lines = input.split("\n");
  if (lines.length === 0) return [];

  const files: FileDiff[] = [];
  let currentFile: FileDiff | null = null;
  let currentChunk: Chunk | null = null;
  let deletedLineCounter = 0;
  let addedLineCounter = 0;
  let currentFileChanges: { oldLines: number; newLines: number } | null = null;

  const normal = (line: string) => {
    currentChunk?.changes.push({
      type: "normal",
      normal: true,
      ln1: deletedLineCounter++,
      ln2: addedLineCounter++,
      content: line,
    });
    currentFileChanges!.oldLines--;
    currentFileChanges!.newLines--;
  };

  const start = (line: string) => {
    const [fromFileName, toFileName] = parseFiles(line) ?? [];

    currentFile = {
      chunks: [],
      deletions: 0,
      additions: 0,
      from: fromFileName,
      to: toFileName,
    };

    files.push(currentFile);
  };

  const restart = () => {
    if (!currentFile || currentFile.chunks.length) start("");
  };

  const newFile = (_: string, match: RegExpMatchArray) => {
    restart();
    currentFile!.new = true;
    currentFile!.newMode = match[1];
    currentFile!.from = "/dev/null";
  };

  const deletedFile = (_: string, match: RegExpMatchArray) => {
    restart();
    currentFile!.deleted = true;
    currentFile!.oldMode = match[1];
    currentFile!.to = "/dev/null";
  };

  const oldMode = (_: string, match: RegExpMatchArray) => {
    restart();
    currentFile!.oldMode = match[1];
  };

  const newMode = (_: string, match: RegExpMatchArray) => {
    restart();
    currentFile!.newMode = match[1];
  };

  const index = (line: string, match: RegExpMatchArray) => {
    restart();
    currentFile!.index = line.split(" ").slice(1);
    if (match[1]) {
      currentFile!.oldMode = currentFile!.newMode = match[1].trim();
    }
  };

  const fromFile = (line: string) => {
    restart();
    currentFile!.from = parseOldOrNewFile(line);
  };

  const toFile = (line: string) => {
    restart();
    currentFile!.to = parseOldOrNewFile(line);
  };

  const toNumOfLines = (number: string) => +(number || 1);

  const chunk = (line: string, match: RegExpMatchArray) => {
    if (!currentFile) {
      start(line);
    }

    const [oldStart, oldNumLines, newStart, newNumLines] = match.slice(1);

    deletedLineCounter = +oldStart;
    addedLineCounter = +newStart;
    currentChunk = {
      content: line,
      changes: [],
      oldStart: +oldStart,
      oldLines: toNumOfLines(oldNumLines),
      newStart: +newStart,
      newLines: toNumOfLines(newNumLines),
    };
    currentFileChanges = {
      oldLines: toNumOfLines(oldNumLines),
      newLines: toNumOfLines(newNumLines),
    };
    currentFile!.chunks.push(currentChunk);
  };

  const del = (line: string) => {
    if (!currentChunk) return;

    currentChunk.changes.push({
      type: "del",
      del: true,
      ln: deletedLineCounter++,
      content: line,
    });
    currentFile!.deletions++;
    currentFileChanges!.oldLines--;
  };

  const add = (line: string) => {
    if (!currentChunk) return;

    currentChunk.changes.push({
      type: "add",
      add: true,
      ln: addedLineCounter++,
      content: line,
    });
    currentFile!.additions++;
    currentFileChanges!.newLines--;
  };

  const eof = (line: string) => {
    if (!currentChunk) return;

    const [mostRecentChange] = currentChunk.changes.slice(-1);

    currentChunk.changes.push({
      type: mostRecentChange.type,
      [mostRecentChange.type]: true,
      ln1: mostRecentChange.ln1,
      ln2: mostRecentChange.ln2,
      ln: mostRecentChange.ln,
      content: line,
    });
  };

  const schemaHeaders: [RegExp, (line: string, match: RegExpMatchArray) => void][] = [
    [/^diff\s/, start],
    [/^new file mode (\d+)$/, newFile],
    [/^deleted file mode (\d+)$/, deletedFile],
    [/^old mode (\d+)$/, oldMode],
    [/^new mode (\d+)$/, newMode],
    [/^index\s[\da-zA-Z]+\.\.[\da-zA-Z]+(\s(\d+))?$/, index],
    [/^---\s/, fromFile],
    [/^\+\+\+\s/, toFile],
    [/^@@\s+-(\d+),?(\d+)?\s+\+(\d+),?(\d+)?\s@@/, chunk],
    [/^\\ No newline at end of file$/, eof],
  ];

  const schemaContent: [RegExp, (line: string, match: RegExpMatchArray) => void][] = [
    [/^\\ No newline at end of file$/, eof],
    [/^-/, del],
    [/^\+/, add],
    [/^\s+/, normal],
  ];

  const parseContentLine = (line: string) => {
    for (const [pattern, handler] of schemaContent) {
      const match = line.match(pattern);
      if (match) {
        handler(line, match);
        break;
      }
    }
    if (currentFileChanges?.oldLines === 0 && currentFileChanges?.newLines === 0) {
      currentFileChanges = null;
    }
  };

  const parseHeaderLine = (line: string) => {
    for (const [pattern, handler] of schemaHeaders) {
      const match = line.match(pattern);
      if (match) {
        handler(line, match);
        break;
      }
    }
  };

  const parseLine = (line: string) => {
    if (currentFileChanges) {
      parseContentLine(line);
    } else {
      parseHeaderLine(line);
    }
  };

  for (const line of lines) parseLine(line);

  return files;
}

const fileNameDiffRegex = /(a|i|w|c|o|1|2)\/.*(?=["']? ["']?(b|i|w|c|o|1|2)\/)|(b|i|w|c|o|1|2)\/.*$/g;
const gitFileHeaderRegex = /^(a|b|i|w|c|o|1|2)\//;
export function parseFiles(line: string): string[] | undefined {
  const fileNames = line.match(fileNameDiffRegex);
  return fileNames?.map((fileName) => fileName.replace(gitFileHeaderRegex, "").replace(/("|')$/, ""));
}

const quotedFileNameRegex = /^\\?['"]|\\?['"]$/g;
export function parseOldOrNewFile(line: string): string {
  let fileName = leftTrimChars(line, "-+").trim();
  fileName = removeTimeStamp(fileName);
  return fileName.replace(quotedFileNameRegex, "").replace(gitFileHeaderRegex, "");
}

export function leftTrimChars(string: string, trimmingChars: string): string {
  string = makeString(string);
  // if (!trimmingChars && String.prototype.trimLeft) return string.trimLeft();
  if (!trimmingChars) return string.trimStart();

  const trimmingString = formTrimmingString(trimmingChars);
  return string.replace(new RegExp(`^${trimmingString}+`), "");
}

const timeStampRegex = /\t.*|\d{4}-\d\d-\d\d\s\d\d:\d\d:\d\d(.\d+)?\s(\+|-)\d\d\d\d/;
export function removeTimeStamp(string: string): string {
  const timeStamp = timeStampRegex.exec(string);
  if (timeStamp) {
    string = string.substring(0, timeStamp.index).trim();
  }
  return string;
}

export function formTrimmingString(trimmingChars: string | RegExp): string {
  if (trimmingChars === null || trimmingChars === undefined) return "\\s";
  else if (trimmingChars instanceof RegExp) return trimmingChars.source;
  return `[${makeString(trimmingChars).replace(/([.*+?^=!:${}()|[\]/\\])/g, "\\$1")}]`;
}

export function makeString(itemToConvert: any): string {
  return (itemToConvert ?? "") + "";
}

export default parseDiff;
export type { Chunk, FileDiff as File };
