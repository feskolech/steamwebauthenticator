class WsHub {
  private readonly clients = new Map<number, Set<any>>();

  private toSocket(connection: any): any {
    return connection?.socket ?? connection;
  }

  add(userId: number, connection: any): void {
    const socket = this.toSocket(connection);
    if (!socket || typeof socket.on !== 'function') {
      return;
    }

    const list = this.clients.get(userId) ?? new Set<any>();
    list.add(socket);
    this.clients.set(userId, list);

    socket.on('close', () => {
      const current = this.clients.get(userId);
      if (!current) {
        return;
      }
      current.delete(socket);
      if (current.size === 0) {
        this.clients.delete(userId);
      }
    });
  }

  sendToUser(userId: number, event: string, payload: unknown): void {
    const list = this.clients.get(userId);
    if (!list || list.size === 0) {
      return;
    }

    const message = JSON.stringify({ event, payload, ts: Date.now() });
    for (const conn of list) {
      const isOpen = conn.readyState === conn.OPEN || conn.readyState === 1;
      if (isOpen && typeof conn.send === 'function') {
        conn.send(message);
      }
    }
  }
}

export const wsHub = new WsHub();
