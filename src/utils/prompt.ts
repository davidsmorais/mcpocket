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

type InkModule = {
  Box: any;
  Text: any;
  render: (node: any, options?: { exitOnCtrlC?: boolean }) => { unmount: () => void };
  useInput: (handler: (input: string, key: { upArrow?: boolean; downArrow?: boolean; pageUp?: boolean; pageDown?: boolean; return?: boolean; ctrl?: boolean }) => void) => void;
};

type ReactModule = {
  createElement: (type: any, props?: any, ...children: any[]) => any;
  useMemo: <T>(factory: () => T, deps: readonly unknown[]) => T;
  useState: <T>(initial: T | (() => T)) => [T, (value: T | ((prev: T) => T)) => void];
};

const dynamicImport = new Function('modulePath', 'return import(modulePath)') as (modulePath: string) => Promise<any>;

async function loadInkRuntime(): Promise<{ React: ReactModule; ink: InkModule }> {
  const [React, ink] = await Promise.all([
    dynamicImport('react'),
    dynamicImport('ink'),
  ]);
  return { React, ink };
}

async function runInkPrompt<T>(
  buildApp: (runtime: {
    React: ReactModule;
    ink: InkModule;
    submit: (value: T) => void;
    cancel: () => void;
  }) => any,
): Promise<T> {
  const { React, ink } = await loadInkRuntime();

  return new Promise<T>((resolve) => {
    let settled = false;
    let instance: { unmount: () => void } | undefined;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
      setImmediate(() => instance?.unmount());
    };

    const submit = (value: T): void => {
      finish(() => resolve(value));
    };

    const cancel = (): void => {
      finish(() => process.exit(1));
    };

    const App = () => buildApp({ React, ink, submit, cancel });
    instance = ink.render(React.createElement(App), { exitOnCtrlC: false });
  });
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
  return runInkPrompt<T[]>(({ React, ink, submit, cancel }) => {
    const { Box, Text, useInput } = ink;
    const [cursor, setCursor] = React.useState(0);
    const [selected, setSelected] = React.useState<Set<number>>(() => new Set(options.map((_, i) => i)));

    const viewportSize = Math.max(3, ((process.stdout as any).rows ?? 24) - 8);
    const firstIndex = Math.min(Math.max(0, cursor - Math.floor(viewportSize / 2)), Math.max(0, options.length - viewportSize));
    const lastIndex = Math.min(firstIndex + viewportSize, options.length);

    const visible = React.useMemo(
      () => options.slice(firstIndex, lastIndex).map((opt, idx) => ({ option: opt, index: firstIndex + idx })),
      [firstIndex, lastIndex],
    );

    const toggleIndices = (indices: number[]): void => {
      if (indices.length === 0) return;
      setSelected((prev) => {
        const next = new Set(prev);
        const allSelected = indices.every((i) => next.has(i));
        for (const i of indices) {
          if (allSelected) next.delete(i);
          else next.add(i);
        }
        return next;
      });
    };

    useInput((input, key) => {
      if (key.ctrl && input === 'c') {
        cancel();
        return;
      }
      if (key.return) {
        submit(options.filter((_, i) => selected.has(i)).map((o) => o.value));
        return;
      }
      if (input === ' ') {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(cursor)) next.delete(cursor);
          else next.add(cursor);
          return next;
        });
        return;
      }
      if (input === 'a' || input === 'A') {
        setSelected((prev) => {
          if (prev.size === options.length) return new Set<number>();
          return new Set<number>(options.map((_, i) => i));
        });
        return;
      }
      if (input === 'g' || input === 'G') {
        toggleIndices(options.map((opt, i) => (opt.label.includes('[agent]') ? i : -1)).filter((i) => i >= 0));
        return;
      }
      if (input === 's' || input === 'S') {
        toggleIndices(options.map((opt, i) => (opt.label.includes('[skill]') ? i : -1)).filter((i) => i >= 0));
        return;
      }
      if (key.upArrow || input === 'k') {
        setCursor((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setCursor((prev) => Math.min(options.length - 1, prev + 1));
        return;
      }
      if (key.pageUp) {
        setCursor((prev) => Math.max(0, prev - viewportSize));
        return;
      }
      if (key.pageDown) {
        setCursor((prev) => Math.min(options.length - 1, prev + viewportSize));
      }
    });

    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(Text, { color: 'magentaBright', bold: true }, `✦ ${question}`),
      React.createElement(Text, { dimColor: true }, `${selected.size}/${options.length} selected`),
      ...visible.map(({ option, index }) => {
        const isActive = index === cursor;
        const isSelected = selected.has(index);
        const prefix = isActive ? '❯' : ' ';
        const marker = isSelected ? '●' : '○';
        return React.createElement(
          Text,
          { key: String(index), color: isActive ? 'cyan' : undefined, bold: isActive || undefined },
          ` ${prefix} ${marker} ${option.label}`,
        );
      }),
      React.createElement(
        Text,
        { dimColor: true },
        `${firstIndex > 0 ? '↑ more' : '      '} · ${lastIndex < options.length ? '↓ more' : '      '}`,
      ),
      React.createElement(
        Text,
        { dimColor: true },
        ' ↑/↓ navigate   PgUp/PgDn   space toggle   a all   g agents   s skills   Enter confirm',
      ),
    );
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
  return runInkPrompt<T>(({ React, ink, submit, cancel }) => {
    const { Box, Text, useInput } = ink;
    const [cursor, setCursor] = React.useState(0);
    const viewportSize = Math.max(3, ((process.stdout as any).rows ?? 24) - 6);
    const firstIndex = Math.min(Math.max(0, cursor - Math.floor(viewportSize / 2)), Math.max(0, options.length - viewportSize));
    const lastIndex = Math.min(firstIndex + viewportSize, options.length);
    const visible = options.slice(firstIndex, lastIndex);

    useInput((input, key) => {
      if (key.ctrl && input === 'c') {
        cancel();
        return;
      }
      if (key.return) {
        submit(options[cursor].value);
        return;
      }
      if (key.upArrow || input === 'k') {
        setCursor((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setCursor((prev) => Math.min(options.length - 1, prev + 1));
      }
    });

    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(Text, { color: 'magentaBright', bold: true }, `✦ ${question}`),
      ...visible.map((opt, i) => {
        const index = firstIndex + i;
        const isActive = index === cursor;
        const prefix = isActive ? '❯' : ' ';
        return React.createElement(
          Text,
          { key: String(index), color: isActive ? 'cyan' : undefined, bold: isActive || undefined },
          ` ${prefix} ${opt.label}`,
        );
      }),
      React.createElement(Text, { dimColor: true }, ' ↑/↓ navigate   Enter select'),
    );
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
