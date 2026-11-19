
export function writeStdoutFully(value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      process.stdout.off("error", onError);
      reject(error);
    };
    process.stdout.once("error", onError);
    process.stdout.write(value, (error) => {
      process.stdout.off("error", onError);
      if (error) reject(error);
      else resolve();
    });
  });
}
