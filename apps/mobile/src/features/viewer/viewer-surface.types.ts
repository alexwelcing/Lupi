import type {
  ViewerBridgeRequest,
  ViewerSurfaceMessage,
} from "./viewer-bridge";

export interface ViewerSurfaceHandle {
  execute: (request: ViewerBridgeRequest) => void;
  probe: (id: string) => void;
  reload: () => void;
}

export interface ViewerSurfaceProps {
  sourceUrl: string;
  onMessage: (message: ViewerSurfaceMessage) => void;
}
