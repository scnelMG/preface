export interface EyeBasis {
  side: 'L' | 'R'; inner: number[]; outer: number[]; t: number[]; up: number[]; forward: number[]; width: number;
  local(point: ArrayLike<number>): number[];
  upperCurve?: number[] | null; faceTilt?: [number, number]; crease?: EyeBasis;
}
export interface RefineSources { original: number; offsets: Uint32Array; ids: Uint32Array; weights: Float32Array }
export interface LidSkin { front: { L: Float32Array; R: Float32Array }; normal: Float32Array }
export interface EyeShapeRig { base: Float32Array; normals: Float32Array; indices: Uint32Array; basis: EyeBasis[]; spheres: object[]; lid?: LidSkin }
export const LID_STEP: { margin_row: number; margin_roll: number; max_row: number; c_min: number; strip_pow: number; lash_hold: number; line_min: number; lip: number; frame_smooth: number; depth: number; edit: { depth: number; lip: number; rise_pow: number } };
export function lidSink(a: number, h: number, c: number, lip?: number, risePow?: number): number;
export function lidDepth(crease: number): number;
export const LID_TAIL: [number, number];
export const LID_ENDS: number;
export function lidSkin(mesh: { positions: Float32Array; indices: ArrayLike<number>; template: ArrayLike<number> }, sources?: RefineSources): LidSkin;
export function lidFoldPositions(base: Float32Array, eyes: EyeBasis[], values: object, selection: string, style: string, lid: LidSkin): Float32Array;
export interface EyeShapeHealth { amount: number; limited: number; region: number; sharp: number }
export const EYE_SAFE_RULE: { sharpPerRegion: number; limitedPerRegion: number; step: number };
export const FOLD_DEPTH_MAX: number;
export const FOLD_DEFAULT: number;
export function eyeRegionCount(rig: EyeShapeRig, selection?: string): number;
export function isEyeStateSafe(rig: EyeShapeRig, sides: { selection: string; values: object }[], rule?: typeof EYE_SAFE_RULE): boolean;
export const FOLD_LIMIT_CONTROLS: string[];
export const TRIM_LIMIT_CONTROLS: string[];
export function buildEyeBasis(points: (number[] | undefined)[], options?: { templateBias?: boolean }): EyeBasis[];
export const TEMPLATE_EYE_BIAS: { upper: number[][]; lower: number[][] };
export function fitEyeSpheres(points: number[][], eyes: EyeBasis[]): object[];
export function refineEyeMesh(mesh: {positions: Float32Array; normals: Float32Array; uv?: ArrayLike<number>; indices: ArrayLike<number>}, eyes: EyeBasis[], levels: number): {positions: Float32Array; normals: Float32Array; uv: Float32Array; indices: Uint32Array; sources: RefineSources};
export function transferRefined(sources: RefineSources, values: ArrayLike<number>, itemSize?: number): Float32Array;
export function creaseHeights(height?: number, style?: string): number[];
export const CREASE_TURN: number;
export const CREASE_TAIL_SLOPE: number;
export function creaseLine(eye: EyeBasis, u: number, heights: number[], style?: string): number;
export const CREASE_TAIL_RATIO: number;
export const CREASE_TAIL_CAP: number;
export const CREASE_TAIL_FLARE: number;
export const CREASE_LINE_RULE: { shrink: number; ratio: [number, number]; rise: number; bendStep: number };
export function inspectCreaseLine(eye: EyeBasis, height: number, style?: string): { shrink: number; ratio: number; rise: number; bendStep: number; bendAt: number; ok: boolean };
export function curvePoint(eye: EyeBasis, u: number, heights: number[], style?: string): number[];
export function composeEyeDeformation(base: Float32Array, eyes: EyeBasis[], values: object, selection: string, style: string, normals: Float32Array, indices: ArrayLike<number>, spheres: object[], lid?: LidSkin): {positions: Float32Array; reductions: {side: string; control: string; retention: number}[]; limited: number; foldLimited: number; foldMask: Uint8Array; foldAmount: number; rimAmount: number};
export function newSharpEdges(base: Float32Array, positions: Float32Array, indices: Uint32Array, mask?: Uint8Array): number;
export function eyeShapeHealth(rig: EyeShapeRig, values: object, selection?: string): EyeShapeHealth;
export function isEyeShapeSafe(health: EyeShapeHealth, rule?: typeof EYE_SAFE_RULE): boolean;
export function findSafeLimit(isSafe: (value: number) => boolean, min?: number, max?: number, step?: number): number;
export function scanSafeLimit(isSafe: (value: number) => boolean, min?: number, max?: number, coarse?: number, step?: number): number;
export function measureEyeSafeLimit(rig: EyeShapeRig, control: string, options?: { style?: string; eligible?: { L: boolean; R: boolean } }, rule?: typeof EYE_SAFE_RULE): number;
