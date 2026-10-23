/**
 * Web shim for `react-native-udp`.
 *
 * UDP sockets are not available to page JavaScript. DLNA discovery sends SSDP
 * packets over UDP multicast, so it cannot work here; this socket accepts the
 * same calls and simply never receives anything (and so finds no renderers).
 *
 * The transport stays functional: a renderer added by IP is probed over HTTP
 * by the DLNA code, which does work from the browser.
 */
type Handler = (...args: unknown[]) => void;

class NoopSocket {
  private handlers = new Map<string, Handler[]>();

  on(event: string, handler: Handler): this {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  once(event: string, handler: Handler): this {
    const wrapped: Handler = (...args) => {
      this.off(event, wrapped);
      handler(...args);
    };
    return this.on(event, wrapped);
  }

  off(event: string, handler: Handler): this {
    this.handlers.set(
      event,
      (this.handlers.get(event) ?? []).filter(candidate => candidate !== handler),
    );
    return this;
  }

  removeListener(event: string, handler: Handler): this {
    return this.off(event, handler);
  }

  removeAllListeners(event?: string): this {
    if (event) this.handlers.delete(event);
    else this.handlers.clear();
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }

  bind(_port?: number, callback?: () => void): this {
    queueMicrotask(() => {
      this.emit('listening');
      callback?.();
    });
    return this;
  }

  send(...args: unknown[]): boolean {
    const callback = args[args.length - 1];
    if (typeof callback === 'function') (callback as Handler)();
    return true;
  }

  close(callback?: () => void): this {
    callback?.();
    return this;
  }

  addMembership(): void {}
  dropMembership(): void {}
  setBroadcast(): void {}
  setMulticastTTL(): void {}
  setMulticastLoopback(): void {}

  address(): { address: string; port: number } {
    return { address: '0.0.0.0', port: 0 };
  }
}

const UdpSockets = {
  createSocket: (_options?: unknown): NoopSocket => new NoopSocket(),
};

export default UdpSockets;
export { NoopSocket };
