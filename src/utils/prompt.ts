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

export interface MultiSelectOption<T> {
  label: string;
  value: T;
}

/**
 * Show a numbered list of options and let the user pick a subset by typing
 * comma-separated numbers (e.g. "1,3"). Pressing Enter with no input selects all.
 * Returns the selected values.
 */
export async function askMultiSelect<T>(
  question: string,
  options: MultiSelectOption<T>[]
): Promise<T[]> {
  console.log(`\n  ${question}`);
  options.forEach((opt, i) => {
    console.log(`    [${i + 1}] ${opt.label}`);
  });
  const answer = await ask('  Select (comma-separated numbers, or Enter for all): ');

  if (!answer.trim()) {
    return options.map((o) => o.value);
  }

  const selected: T[] = [];
  for (const part of answer.split(',')) {
    const idx = parseInt(part.trim(), 10) - 1;
    if (!Number.isNaN(idx) && idx >= 0 && idx < options.length) {
      selected.push(options[idx].value);
    }
  }

  return selected.length > 0 ? selected : options.map((o) => o.value);
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
