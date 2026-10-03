import type { EngineStatus } from "@shared/protocol";

export class ReconnectCounter {
  private exits = 0;
  connection: EngineStatus = "reconnecting";

  get count(): number {
    return this.exits;
  }

  connected(): void {
    this.connection = "connected";
  }

  unexpectedExit(): EngineStatus {
    this.exits += 1;
    this.connection = "reconnecting";
    return this.connection;
  }
}
