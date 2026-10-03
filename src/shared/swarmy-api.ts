import type { ConnectionInfo, HelloInfo } from "./settings";
import type { EngineStatus } from "./protocol";

export interface SwarmyApi {
  engine: {
    onStatus(listener: (status: EngineStatus) => void): () => void;
  };
  settings: {
    saveKey(apiKey: string): Promise<void>;
    hasKey(): Promise<boolean>;
    testConnection(): Promise<ConnectionInfo>;
    runHello(): Promise<HelloInfo>;
  };
}
