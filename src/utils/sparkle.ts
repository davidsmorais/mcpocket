/**
 * Whimsical CLI animations & personality for mcpocket.
 * Because syncing your AI setup should feel like magic, not homework.
 */

/* ── ANSI helpers ────────────────────────────────────── */
export const c = {
  bold:    (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim:     (s: string) => `\x1b[2m${s}\x1b[0m`,
  cyan:    (s: string) => `\x1b[36m${s}\x1b[0m`,
  green:   (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow:  (s: string) => `\x1b[33m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
  blue:    (s: string) => `\x1b[34m${s}\x1b[0m`,
  red:     (s: string) => `\x1b[31m${s}\x1b[0m`,
  white:   (s: string) => `\x1b[37m${s}\x1b[0m`,
} as const;

const BANNER_LINES = [
  { color: 36, text: '                 .------------------------.' },
  { color: 36, text: String.raw`            .---/  .------------------.  \---.` },
  { color: 35, text: String.raw`         .-'   /  /   .-''''''-.      \  \   '-.` },
  { color: 35, text: String.raw`       .'     /  /   /  .--.    \      \  \     '.` },
  { color: 36, text: String.raw`      /      /  /   |  / /\ \    |      \  \      \ ` },
  { color: 36, text: '     ;      |  |    | | |  | |   |        |  |      ;' },
  { color: 33, text: String.raw`     |      |  |    | |  /\/ |   |   /\   |  |      |` },
  { color: 33, text: String.raw`     ;      |  |    | |  \/  |   |  /__\  |  |      ;` },
  { color: 36, text: String.raw`      \      \  \   |  \____/   /      /  /      /` },
  { color: 35, text: String.raw`       '.     \  \   '-._____.-'     /  /     .'` },
  { color: 35, text: String.raw`         '-.   \  '----------------'  /   .-'` },
  { color: 36, text: String.raw`            '---\____________________/---'` },
  { color: 34, text: '' },
  { color: 34, text: ' __  __  ____ ____   ___   ____ _  _______ _____ ' },
  { color: 34, text: String.raw`|  \/  |/ ___|  _ \ / _ \ / ___| |/ / ____|_   _|` },
  { color: 34, text: String.raw`| |\/| | |   | |_) | | | | |   | ' /|  _|   | |  ` },
  { color: 34, text: String.raw`| |  | | |___|  __/| |_| | |___| . \| |___  | |  ` },
  { color: 34, text: String.raw`|_|  |_|\____|_|    \___/ \____|_|\_\_____| |_|  ` },
  { color: 37, text: '' },
  { color: 37, text: '              Your AI setup. Every pocket.' },
] as const;

const FRAMES_SYNC = ['◐', '◓', '◑', '◒'];
const FRAMES_SPARKLE = ['✦', '✧', '✦', '★', '✧', '⋆'];
const FRAMES_ROCKET = ['🚀', '🌟', '✨', '💫'];

/**
 * Print the mcpocket ASCII art banner — a friendly hello.
 */
export function printBanner(): void {
  console.log('');
  for (const line of BANNER_LINES) {
    console.log(`\x1b[${line.color}m${line.text}\x1b[0m`);
  }
  console.log('');
}

/**
 * Animated spinner that returns a stop() function.
 * Call stop() when your async work is done.
 */
export function spinner(message: string): { stop: (finalMsg?: string) => void } {
  let i = 0;
  const interval = setInterval(() => {
    const frame = FRAMES_SYNC[i % FRAMES_SYNC.length];
    process.stdout.write(`\r  ${frame} ${message}`);
    i++;
  }, 120);

  return {
    stop(finalMsg?: string) {
      clearInterval(interval);
      process.stdout.write('\r' + ' '.repeat(message.length + 10) + '\r');
      if (finalMsg) {
        console.log(`  ${finalMsg}`);
      }
    },
  };
}

/**
 * Sparkle trail effect — prints a cascade of sparkles, then your message.
 */
export function sparkle(message: string): void {
  const frame = FRAMES_SPARKLE[Math.floor(Math.random() * FRAMES_SPARKLE.length)];
  console.log(`  ${c.magenta(frame)} ${message}`);
}

/**
 * Print a success celebration.
 */
export function celebrate(message: string): void {
  const frame = FRAMES_ROCKET[Math.floor(Math.random() * FRAMES_ROCKET.length)];
  console.log(`\n  ${frame} \x1b[32m${message}\x1b[0m ${frame}`);
}

/**
 * Print a whimsical section header with a decorative line.
 */
export function section(title: string): void {
  const line = '─'.repeat(Math.max(0, 44 - title.length));
  console.log(`\n  \x1b[36m── ${title} ${line}\x1b[0m`);
}

/**
 * Print a friendly stat line (for summaries).
 */
export function stat(label: string, value: string | number): void {
  console.log(`    \x1b[33m${label}\x1b[0m  ${c.bold(String(value))}`);
}

/**
 * Print a hierarchical sub-item (indented under a parent section).
 * Supports optional checkmark prefix and value suffix.
 */
export function subItem(label: string, options: { check?: boolean; value?: string; muted?: boolean } = {}): void {
  const prefix = options.check === true ? c.green('✓') : options.check === false ? c.red('✗') : ' ';
  const valueStr = options.value ? `  ${c.bold(options.value)}` : '';
  const labelStr = options.muted ? c.dim(label) : label;
  console.log(`      ${prefix} ${labelStr}${valueStr}`);
}

/**
 * Print a provider header in hierarchical display.
 */
export function providerHeader(name: string): void {
  console.log(`    ${c.cyan('▸')} ${c.bold(name)}`);
}

/**
 * Print a project header in hierarchical display.
 */
export function projectHeader(name: string, fileCount?: number): void {
  const count = fileCount !== undefined ? `  ${c.dim(`(${fileCount} file${fileCount === 1 ? '' : 's'})`)}` : '';
  console.log(`    ${c.yellow('▸')} ${c.bold(name)}${count}`);
}

/**
 * Print a warm, friendly error — problems happen, we're chill about it.
 */
export function oops(message: string): void {
  console.error(`\n  \x1b[31m✗ Oops!\x1b[0m ${message}`);
}

/**
 * Print a gentle warning.
 */
export function heads_up(message: string): void {
  console.log(`  \x1b[33m⚡\x1b[0m ${message}`);
}

/**
 * Witty progress messages for different operations.
 */
export const WITTY = {
  pulling: 'Reaching into the cloud pocket...',
  pushing: 'Tucking your setup into the pocket...',
  encrypting: 'Wrapping secrets in tinfoil...',
  decrypting: 'Unwrapping the secret sauce...',
  cloning: 'Setting up your secret stash...',
  verifying: 'Checking your credentials (no judgment)...',
  readingMCP: 'Rounding up your MCP servers...',
  readingPlugins: 'Collecting plugin souvenirs...',
  readingAgents: 'Gathering your agent squad...',
  readingSkills: 'Packing up your skill tree...',
  done: 'All pocketed!',
  nothingNew: 'Already in sync — you\'re living in the future.',
  pushDone: 'Your setup is safe in the cloud pocket!',
  pullDone: 'Your setup landed safely! Welcome back.',
  initDone: 'mcpocket is ready to roll!',
} as const;
