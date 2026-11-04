/** Holds serialized content independently of an editor that may unmount. */
export class SaveQueue {
  private snapshot: Promise<string> | null = null;
  private deleted = false;
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly save: (markdown: string) => Promise<void>) {}
  change(snapshot: Promise<string>) {
    if (this.deleted) return;
    this.snapshot = snapshot;
    // A conversion failure is retained for flush/retry, but never unhandled.
    void snapshot.catch(() => {});
  }
  async readRetainedSnapshot(): Promise<
    { kind: 'markdown'; markdown: string } | { kind: 'unavailable' }
  > {
    if (this.deleted || !this.snapshot) return { kind: 'unavailable' };
    try {
      return { kind: 'markdown', markdown: await this.snapshot };
    } catch {
      return { kind: 'unavailable' };
    }
  }
  private async drain() {
    while (!this.deleted && this.snapshot) {
      const current = this.snapshot;
      await this.save(await current);
      if (current === this.snapshot) this.snapshot = null;
    }
  }
  flush() {
    this.pending = this.pending.catch(() => {}).then(() => this.drain());
    return this.pending;
  }
  /** Deletion shares the write lane. Failed deletion preserves subsequent edits. */
  remove(remove: () => Promise<void>) {
    this.pending = this.pending
      .catch(() => {})
      .then(async () => {
        if (this.deleted) return;
        await this.drain();
        await remove();
        this.deleted = true;
        this.snapshot = null;
      });
    return this.pending;
  }
}
