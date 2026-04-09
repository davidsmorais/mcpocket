import * as readline from 'readline';

/** Prompt the user for text input */
export function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Prompt for a hidden password (no echo) */
export function askSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write(question);

    // Disable echo
    if (process.stdin.isTTY) {
      (process.stdin as NodeJS.ReadStream).setRawMode(true);
    }

    let input = '';
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (char: string) => {
      if (char === '\n' || char === '\r' || char === '\u0004') {
        process.stdout.write('\n');
        if (process.stdin.isTTY) {
          (process.stdin as NodeJS.ReadStream).setRawMode(false);
        }
        process.stdin.removeListener('data', onData);
        rl.close();
        resolve(input);
      } else if (char === '\u0003') {
        process.stdout.write('\n');
        process.exit(1);
      } else if (char === '\u007f' || char === '\b') {
        input = input.slice(0, -1);
      } else {
        input += char;
      }
    };

    process.stdin.on('data', onData);
  });
}
