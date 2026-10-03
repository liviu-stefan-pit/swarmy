import type { EngineStatus } from "./protocol";

export interface SwarmyApi {
  engine: {
    onStatus(listener: (status: EngineStatus) => void): () => void;
  };
}
