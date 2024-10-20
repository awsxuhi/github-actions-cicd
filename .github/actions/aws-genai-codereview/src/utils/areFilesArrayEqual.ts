export function areFilesArrayEqual(fileArray1: Array<{ filename: string }>, fileArray2: Array<{ filename: string }>): boolean {
  if (fileArray1.length !== fileArray2.length) {
    console.info("Files and incrementalFiles are not equal in length.");
    return false;
  }

  const filenames1 = fileArray1.map((file) => file.filename).sort();
  const filenames2 = fileArray2.map((file) => file.filename).sort();

  for (let i = 0; i < filenames1.length; i++) {
    if (filenames1[i] !== filenames2[i]) {
      console.info(`result from areFilesArrayEqual(): NOT equal. Mismatch at filename: ${filenames1[i]} vs ${filenames2[i]}`);
      return false;
    }
  }

  console.info("result from areFilesArrayEqual(): equal.");
  return true;
}
