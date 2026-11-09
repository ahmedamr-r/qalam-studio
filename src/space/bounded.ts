/**
 * Work started a few at a time (pure): each starts as soon as fewer than `n` are running, and the
 * promises come back in the order given, so what reads them can take each in turn. The canvas's chat
 * reads the files it takes in this way: twenty pictures, each read in the core, three at once.
 */
export function bounded<T>(fns: readonly (() => Promise<T>)[], n: number): Promise<T>[] {
  const waiting: (() => void)[] = [];
  let free = Math.max(1, n);
  const take = () => (free > 0 ? (free--, Promise.resolve()) : new Promise<void>((go) => waiting.push(go)));
  const give = () => {
    const next = waiting.shift();
    if (next) next();
    else free++;
  };
  return fns.map((fn) => take().then(fn).finally(give));
}
