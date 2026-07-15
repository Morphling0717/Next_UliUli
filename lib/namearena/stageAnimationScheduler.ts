export type StageAnimationHost = {
  setTimeout: (callback: () => void, delay: number) => number;
  clearTimeout: (handle: number) => void;
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame: (handle: number) => void;
};

function createDefaultHost(): StageAnimationHost {
  const requestFrame: (callback: FrameRequestCallback) => number = typeof globalThis.requestAnimationFrame === "function"
    ? globalThis.requestAnimationFrame.bind(globalThis)
    : (callback: FrameRequestCallback) => globalThis.setTimeout(() => callback(Date.now()), 16) as unknown as number;
  const cancelFrame: (handle: number) => void = typeof globalThis.cancelAnimationFrame === "function"
    ? globalThis.cancelAnimationFrame.bind(globalThis)
    : (handle) => globalThis.clearTimeout(handle);

  return {
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay) as unknown as number,
    clearTimeout: (handle) => globalThis.clearTimeout(handle),
    requestAnimationFrame: requestFrame,
    cancelAnimationFrame: cancelFrame,
  };
}

export class StageAnimationScheduler {
  private readonly host: StageAnimationHost;
  private readonly generations = new Map<string, number>();
  private readonly timers = new Map<string, Set<number>>();
  private readonly frames = new Map<string, Set<number>>();
  private disposed = false;

  constructor(host: StageAnimationHost = createDefaultHost()) {
    this.host = host;
  }

  begin(scope: string): number {
    this.cancel(scope);
    return this.generation(scope);
  }

  generation(scope: string): number {
    return this.generations.get(scope) ?? 0;
  }

  isCurrent(scope: string, generation: number): boolean {
    return !this.disposed && this.generation(scope) === generation;
  }

  after(scope: string, delay: number, callback: () => void, generation = this.generation(scope)): number | null {
    if (this.disposed) return null;
    let handle = 0;
    handle = this.host.setTimeout(() => {
      this.timers.get(scope)?.delete(handle);
      if (this.isCurrent(scope, generation)) callback();
    }, Math.max(0, delay));
    this.addHandle(this.timers, scope, handle);
    return handle;
  }

  frame(scope: string, callback: FrameRequestCallback, generation = this.generation(scope)): number | null {
    if (this.disposed) return null;
    let handle = 0;
    handle = this.host.requestAnimationFrame((time) => {
      this.frames.get(scope)?.delete(handle);
      if (this.isCurrent(scope, generation)) callback(time);
    });
    this.addHandle(this.frames, scope, handle);
    return handle;
  }

  cancel(scope: string): void {
    this.cancelHandles(this.timers, scope, (handle) => this.host.clearTimeout(handle));
    this.cancelHandles(this.frames, scope, (handle) => this.host.cancelAnimationFrame(handle));
    this.generations.set(scope, this.generation(scope) + 1);
  }

  cancelPrefix(prefix: string): void {
    const scopes = new Set([
      ...this.generations.keys(),
      ...this.timers.keys(),
      ...this.frames.keys(),
    ]);
    scopes.forEach((scope) => {
      if (scope.startsWith(prefix)) this.cancel(scope);
    });
  }

  release(scope: string): void {
    this.cancelHandles(this.timers, scope, (handle) => this.host.clearTimeout(handle));
    this.cancelHandles(this.frames, scope, (handle) => this.host.cancelAnimationFrame(handle));
    this.generations.delete(scope);
  }

  reset(): void {
    const scopes = new Set([
      ...this.generations.keys(),
      ...this.timers.keys(),
      ...this.frames.keys(),
    ]);
    scopes.forEach((scope) => this.cancel(scope));
  }

  pendingCount(scope?: string): number {
    if (scope) return (this.timers.get(scope)?.size ?? 0) + (this.frames.get(scope)?.size ?? 0);
    return [...this.timers.values(), ...this.frames.values()]
      .reduce((total, handles) => total + handles.size, 0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.reset();
    this.disposed = true;
  }

  private addHandle(collection: Map<string, Set<number>>, scope: string, handle: number): void {
    const handles = collection.get(scope) ?? new Set<number>();
    handles.add(handle);
    collection.set(scope, handles);
  }

  private cancelHandles(
    collection: Map<string, Set<number>>,
    scope: string,
    cancel: (handle: number) => void,
  ): void {
    collection.get(scope)?.forEach(cancel);
    collection.delete(scope);
  }
}
