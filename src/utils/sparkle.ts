/**
 * Whimsical CLI animations & personality for mcpocket.
 * Because syncing your AI setup should feel like magic, not homework.
 */

const POCKET_ART = `
  ╭─────────────────────────╮
  │  ┌─────────┐            │
  │  │ mcpocket│  ✨        │
  │  └────┬────┘            │
  │       │  Your AI setup. │
  │       │  Every pocket.  │
  ╰───────┴─────────────────╯
`;

const FRAMES_SYNC = ['◐', '◓', '◑', '◒'];
const FRAMES_SPARKLE = ['✦', '✧', '✦', '★', '✧', '⋆'];
const FRAMES_ROCKET = ['🚀', '🌟', '✨', '💫'];

/**
 * Print the mcpocket ASCII art banner — a friendly hello.
 */
export function printBanner(): void {
  console.log('\x1b[36m' + POCKET_ART + '\x1b[0m');
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
  console.log(`  ${frame} ${message}`);
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
  console.log(`    \x1b[33m${label}\x1b[0m  ${value}`);
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
