/** A termination request is not proof of exit. Keep ownership until the tracked child actually exits. */
export interface SignalTarget {
  kill(signal?: NodeJS.Signals): boolean;
}

export async function exitedWithin(exit: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      exit.then(() => true),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function stopProcess(
  child: SignalTarget,
  exit: Promise<unknown>,
  opts: { termGraceMs?: number; killGraceMs?: number } = {},
): Promise<{ exited: boolean; term_sent: boolean; kill_sent: boolean }> {
  let termSent = false;
  let killSent = false;
  try { termSent = child.kill("SIGTERM"); } catch { /* exit confirmation remains the authority */ }
  if (await exitedWithin(exit, opts.termGraceMs ?? 1000)) return { exited: true, term_sent: termSent, kill_sent: false };
  try { killSent = child.kill("SIGKILL"); } catch { /* report unconfirmed exit, never fabricate success */ }
  const exited = await exitedWithin(exit, opts.killGraceMs ?? 1000);
  return { exited, term_sent: termSent, kill_sent: killSent };
}
