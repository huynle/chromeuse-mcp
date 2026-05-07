/**
 * Logging utility for the native messaging host.
 * Outputs to stderr to avoid interfering with stdout (Chrome native messaging protocol).
 */

const PREFIX = '[ChromeUse Native Host]'

export function log(message: string, ...args: unknown[]): void {
  console.error(`${PREFIX} ${message}`, ...args)
}
