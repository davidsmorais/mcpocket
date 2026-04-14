import * as readline from 'readline';
import { c } from './sparkle.js';

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
 * Interactive multi-select with keyboard navigation.
 *
 * Controls:
 *   ↑ / k       — move cursor up
 *   ↓ / j       — move cursor down
 *   space       — toggle item
 *   a           — toggle all on / all off
 *   enter       — confirm selection
 *   ctrl+c      — exit
 *
 * Falls back to numbered comma-separated input when stdin is not a TTY
 * (e.g. piped input, CI environments).
 */
export async function askMultiSelect<T>(
  question: string,
  options: MultiSelectOption<T>[],
): Promise<T[]> {
  if (options.length === 0) return [];

  if (!process.stdin.isTTY) {
    return askMultiSelectLegacy(question, options);
  }

  // Start with everything selected — user deselects what they don't want.
  const selected = new Set<number>(options.map((_, i) => i));
  let cursor = 0;
  let initialRender = true;

  // question line + one line per option + hint line
  const BLOCK_LINES = options.length + 2;

  function render(): void {
    if (!initialRender) {
      // Jump back to the first line of our block
      process.stdout.write(`\x1b[${BLOCK_LINES}F`);
    }
    initialRender = false;

    // Question
    process.stdout.write(`\x1b[2K  ${question}\n`);

    // Options
    for (let i = 0; i < options.length; i++) {
      const isActive   = i === cursor;
      const isSelected = selected.has(i);
      const pointer    = isActive   ? c.cyan('❯') : ' ';
      const checkbox   = isSelected ? c.green('◉') : c.dim('○');
      const label      = isActive   ? c.bold(options[i].label) : options[i].label;
      process.stdout.write(`\x1b[2K  ${pointer} ${checkbox} ${label}\n`);
    }

    // Hint
    process.stdout.write(
      `\x1b[2K${c.dim('  ↑↓ navigate   space toggle   a toggle all   enter confirm')}\n`,
    );
  }

  // Hide cursor while navigating
  process.stdout.write('\x1b[?25l');
  render();

  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    function cleanup(): void {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\x1b[?25h'); // restore cursor
    }

    function onData(key: string): void {
      // Ctrl+C — abort
      if (key === '\u0003') {
        cleanup();
        process.stdout.write('\n');
        process.exit(1);
      }

      // Enter — confirm
      if (key === '\r' || key === '\n') {
        cleanup();
        process.stdout.write('\n');
        resolve(options.filter((_, i) => selected.has(i)).map((o) => o.value));
        return;
      }

      // Space — toggle current item
      if (key === ' ') {
        if (selected.has(cursor)) {
          selected.delete(cursor);
        } else {
          selected.add(cursor);
        }
        render();
        return;
      }

      // a / A — toggle all on or all off
      if (key === 'a' || key === 'A') {
        if (selected.size === options.length) {
          selected.clear();
        } else {
          for (let i = 0; i < options.length; i++) selected.add(i);
        }
        render();
        return;
      }

      // Arrow up or k — move cursor up (wraps)
      if (key === '\x1b[A' || key === 'k') {
        cursor = (cursor - 1 + options.length) % options.length;
        render();
        return;
      }

      // Arrow down or j — move cursor down (wraps)
      if (key === '\x1b[B' || key === 'j') {
        cursor = (cursor + 1) % options.length;
        render();
        return;
      }
    }

    process.stdin.on('data', onData);
  });
}

/**
 * Fallback for non-TTY environments: numbered list with comma-separated input.
 * Enter with no input selects all.
 */
async function askMultiSelectLegacy<T>(
  question: string,
  options: MultiSelectOption<T>[],
): Promise<T[]> {
  console.log(`\n  ${question}`);
  options.forEach((opt, i) => {
    console.log(`    ${c.cyan(`[${i + 1}]`)} ${opt.label}`);
  });
  const answer = await ask(`  Select ${c.dim('(comma-separated numbers, or Enter for all)')}: `);

  if (!answer.trim()) {
    return options.map((o) => o.value);
  }

  const seen = new Set<number>();
  const deduped: T[] = [];
  for (const part of answer.split(',')) {
    const idx = parseInt(part.trim(), 10) - 1;
    if (!Number.isNaN(idx) && idx >= 0 && idx < options.length && !seen.has(idx)) {
      seen.add(idx);
      deduped.push(options[idx].value);
    }
  }

  if (deduped.length === 0) {
    console.log('  No valid selections — selecting all.');
    return options.map((o) => o.value);
  }

  return deduped;
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
