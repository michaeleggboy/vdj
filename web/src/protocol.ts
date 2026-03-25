/** vdj WebSocket protocol v1 — keep in sync with docs/protocol.md and hand_service/protocol.py */

export const PROTOCOL_VERSION = 1 as const;

export type HelloMessage = {
  v: 1;
  type: "hello";
  service: string;
  jarvis_branch: string;
};

export type ErrorMessage = {
  v: 1;
  type: "error";
  message: string;
};

export type HandPayload = {
  side: "left" | "right";
  label: string;
  confidence: number;
  gesture: string;
  /** 21 landmarks, [x,y,z] with x,y in [0,1] */
  landmarks: [number, number, number][];
  /** Thumb tip ↔ index tip distance in normalized image x/y (optional; client can compute from landmarks). */
  pinch_distance?: number;
  /** Tips below MCP in y (0–4), excluding thumb; optional — client can infer from landmarks. */
  curled_fingers?: number;
  /** Index tip ↔ pinky tip distance in normalized image x/y (optional). */
  finger_spread?: number;
};

export type FrameMessage = {
  v: 1;
  type: "frame";
  t_ms: number;
  img_width: number;
  img_height: number;
  hands: HandPayload[];
};

export type ServerMessage = HelloMessage | FrameMessage | ErrorMessage;

export function parseServerMessage(data: string): ServerMessage | null {
  try {
    const o = JSON.parse(data) as Record<string, unknown>;
    if (o.v !== 1 || typeof o.type !== "string") return null;
    return o as ServerMessage;
  } catch {
    return null;
  }
}
