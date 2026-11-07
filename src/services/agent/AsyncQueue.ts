/** Unbounded FIFO with a single awaiting consumer; producers never block. Items must be objects so `undefined` can mean "empty". */
export class AsyncQueue<T extends object> {
  private readonly items: T[] = [];
  private waiting: ((item: T) => void) | null = null;

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    const waiting = this.waiting;
    if (waiting) {
      this.waiting = null;
      waiting(item);
      return;
    }
    this.items.push(item);
  }

  next(): Promise<T> {
    const item = this.items.shift();
    if (item !== undefined) return Promise.resolve(item);
    return new Promise<T>((resolve) => {
      this.waiting = resolve;
    });
  }
}
