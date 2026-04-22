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

  // Non-TTY (piped input, CI, scripts): return all items silently so automated
  // workflows continue to sync everything without hanging on a prompt.
  if (!process.stdin.isTTY) {
    return options.map((o) => o.value);
  }

  // Start with everything selected — user deselects what they don't want.
  const selected = new Set<number>(options.map((_, i) => i));
  let cursor = 0;
  let offset = 0;
  let initialRender = true;
  let lastBlockLines = 0;

  const computeViewportSize = (): number => {
    const rows = (process.stdout as any).rows ?? 24;
    return Math.max(1, rows - 2);
  };

  // (viewport-based rendering; dynamic height)

  function render(): void {
    const viewportSize = computeViewportSize();
    const firstIndex = offset;
    const lastIndex = Math.min(offset + viewportSize, options.length);
    const visibleCount = Math.max(0, lastIndex - firstIndex);

    if (!initialRender) {
      // Jump back to the first line of our block
      process.stdout.write(`\x1b[${lastBlockLines}F`);
    }
    initialRender = false;

    // Question
    process.stdout.write(`\x1b[2K  ${question}\n`);

    // Visible options
    for (let i = firstIndex; i < lastIndex; i++) {
      const isActive   = i === cursor;
      const isSelected = selected.has(i);
      const pointer    = isActive   ? c.cyan('❯') : ' ';
      const checkbox   = isSelected ? c.green('◉') : c.dim('○');
      const label      = isActive   ? c.bold(options[i].label) : options[i].label;
      process.stdout.write(`\x1b[2K  ${pointer} ${checkbox} ${label}\n`);
    }

    // Fill remaining lines in the viewport with blanks to avoid artifacts
    for (let j = visibleCount; j < viewportSize; j++) {
      process.stdout.write('\x1b[2K\n');
    }

    // Hint
    process.stdout.write(
      `\x1b[2K${c.dim('  ↑/↓ navigate   PageUp/PageDown   Home/End   space toggle   a toggle all   g agents   s skills   Enter confirm')}\n`,
    );

    // Track block height for next render (full block height is viewportSize + 2 lines)
    lastBlockLines = viewportSize + 2;
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

      // g / G — toggle all agents (items with [agent] in label)
      if (key === 'g' || key === 'G') {
        const agentIndices = options
          .map((opt, i) => opt.label.includes('[agent]') ? i : -1)
          .filter((i) => i >= 0);
        if (agentIndices.length === 0) return;
        const allSelected = agentIndices.every((i) => selected.has(i));
        if (allSelected) {
          agentIndices.forEach((i) => selected.delete(i));
        } else {
          agentIndices.forEach((i) => selected.add(i));
        }
        render();
        return;
      }

      // s / S — toggle all skills (items with [skill] in label)
      if (key === 's' || key === 'S') {
        const skillIndices = options
          .map((opt, i) => opt.label.includes('[skill]') ? i : -1)
          .filter((i) => i >= 0);
        if (skillIndices.length === 0) return;
        const allSelected = skillIndices.every((i) => selected.has(i));
        if (allSelected) {
          skillIndices.forEach((i) => selected.delete(i));
        } else {
          skillIndices.forEach((i) => selected.add(i));
        }
        render();
        return;
      }

      // Arrow up or k — move cursor up
      if (key === '\x1b[A' || key === 'k') {
        if (cursor > 0) {
          cursor--;
          if (cursor < offset) offset = cursor;
          render();
        }
        return;
      }

      // Arrow down or j — move cursor down
      if (key === '\x1b[B' || key === 'j') {
        if (cursor < options.length - 1) {
          const viewportSize = computeViewportSize();
          const bottomIndex = offset + viewportSize - 1;
          if (cursor < bottomIndex) {
            cursor++;
          } else if (offset + viewportSize < options.length) {
            offset += viewportSize;
            const vp = computeViewportSize();
            if (offset > options.length - vp) offset = Math.max(0, options.length - vp);
            cursor = offset; // first item of new viewport
          } else {
            cursor = Math.min(cursor + 1, options.length - 1);
          }
          const vp = computeViewportSize();
          if (cursor < offset) cursor = offset;
          if (cursor >= offset + vp) cursor = offset + vp - 1;
          render();
        }
        return;
      }

      // Page Up / Page Down
      if (key === '\x1b[5~') {
        const vp = computeViewportSize();
        if (offset > 0) {
          offset = Math.max(0, offset - vp);
          cursor = offset;
          render();
        }
        return;
      }
      if (key === '\x1b[6~') {
        const vp = computeViewportSize();
        if (offset + vp < options.length) {
          offset = Math.min(offset + vp, Math.max(0, options.length - vp));
          cursor = offset;
          render();
        }
        return;
      }

      // Home / End – jump to first / last page
      if (key === '\x1b[H') {
        offset = 0; cursor = 0; render(); return; // Home
      }
      if (key === '\x1b[F') {
        const vp = computeViewportSize();
        offset = Math.max(0, options.length - vp);
        cursor = offset;
        render();
        return; // End
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

/**
 * Interactive single-select with keyboard navigation.
 *
 * Controls:
 *   ↑ / k   — move cursor up
 *   ↓ / j   — move cursor down
 *   enter   — confirm selection
 *   ctrl+c  — exit
 *
 * Falls back to the first option when stdin is not a TTY.
 */
export async function askSingleSelect<T>(
  question: string,
  options: MultiSelectOption<T>[],
): Promise<T> {
  if (options.length === 0) throw new Error('No options to select from.');

  if (!process.stdin.isTTY) {
    return options[0].value;
  }

  let cursor = 0;
  let initialRender = true;
  const BLOCK_LINES = options.length + 2;

  function render(): void {
    if (!initialRender) {
      process.stdout.write(`\x1b[${BLOCK_LINES}F`);
    }
    initialRender = false;

    process.stdout.write(`\x1b[2K  ${question}\n`);

    for (let i = 0; i < options.length; i++) {
      const isActive = i === cursor;
      const pointer = isActive ? c.cyan('❯') : ' ';
      const label   = isActive ? c.bold(options[i].label) : options[i].label;
      process.stdout.write(`\x1b[2K  ${pointer} ${label}\n`);
    }

    process.stdout.write(
      `\x1b[2K${c.dim('  ↑↓ navigate   enter select')}\n`,
    );
  }

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
      process.stdout.write('\x1b[?25h');
    }

    function onData(key: string): void {
      if (key === '\u0003') {
        cleanup();
        process.stdout.write('\n');
        process.exit(1);
      }

      if (key === '\r' || key === '\n') {
        cleanup();
        process.stdout.write('\n');
        resolve(options[cursor].value);
        return;
      }

      if (key === '\x1b[A' || key === 'k') {
        cursor = (cursor - 1 + options.length) % options.length;
        render();
        return;
      }

      if (key === '\x1b[B' || key === 'j') {
        cursor = (cursor + 1) % options.length;
        render();
        return;
      }
    }

    process.stdin.on('data', onData);
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
