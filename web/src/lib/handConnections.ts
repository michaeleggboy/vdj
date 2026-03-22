/**
 * Outer perimeter of the hand for filled silhouette (wrist → pinky → tips → index → thumb → wrist).
 * Order matches common MediaPipe outline; indices are landmark ids 0–20.
 */
export const HAND_OUTLINE_ORDER: readonly number[] = [
  0, 17, 18, 19, 20, 16, 12, 8, 7, 6, 5, 4, 3, 2, 1,
];

/** MediaPipe-style hand topology (21 landmarks). */
export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
];
