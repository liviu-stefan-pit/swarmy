import { listenOnParentPort, readParentPort } from "./parent-port";

listenOnParentPort(readParentPort());
