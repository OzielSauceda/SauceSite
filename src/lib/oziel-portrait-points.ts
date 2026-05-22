export type AnchorNodeId =
  | "interfaces"
  | "research"
  | "design"
  | "computer-science"
  | "ai"
  | "prototypes"
  | "experiments"
  | "systems";

export type PortraitPoint = { x: number; y: number };

// Cleared portrait target. These anchors match the original constellation
// layout so the node system stays intact without forming a face image.
export const PORTRAIT_ANCHORS: Record<AnchorNodeId, PortraitPoint> = {
  interfaces: { x: 72, y: 50 },
  research: { x: 72, y: 16 },
  design: { x: 88, y: 30 },
  ai: { x: 88, y: 70 },
  prototypes: { x: 60, y: 82 },
  experiments: { x: 56, y: 30 },
  "computer-science": { x: 53, y: 68 },
  systems: { x: 90, y: 50 },
};

export const PORTRAIT_MICRO: ReadonlyArray<PortraitPoint> = [];

export const PORTRAIT_FEATURE_EDGES: ReadonlyArray<{ a: number; b: number }> =
  [];

export const PORTRAIT_BBOX = {
  minX: 0,
  maxX: 0,
  minY: 0,
  maxY: 0,
};
