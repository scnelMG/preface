export function protectedNoseSkinVertices(metadata: unknown): Set<number> | null;
export function auditNoseSkinGeometry(input: {
  base: Float32Array;
  edited: Float32Array;
  template: ArrayLike<number>;
  index: ArrayLike<number>;
  protectedVertices: ReadonlySet<number> | null;
}): {
  valid: boolean;
  affectedVertices: number;
  protectedAffectedVertices: number;
  protectedRegionsPresent: boolean;
  selfIntersections: number;
};
