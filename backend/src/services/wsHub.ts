class WsHub {
  private readonly clients = new Map<number, Set<any>>();

  add(userId: number, connection: any): void {
    const list = this.clients.get(userId) ?? new Set<any>();
    list.add(connection);
    this.clients.set(userId, list);

    connection.socket.on('close', () => {
      const current = this.clients.get(userId);
      if (!current) {
        return;
      }
      current.delete(connection);
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
      if (conn.socket.readyState === conn.socket.OPEN) {
        conn.socket.send(message);
      }
    }
  }
}

export const wsHub = new WsHub();
