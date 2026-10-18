type Vec2 = [number, number];
type Vec3 = [number, number, number];
type VertexId = string;
type HalfEdgeId = string;
type LoopId = string;
type FaceId = string;
type ObjectId = string;
type GroupId = string;
type EdgeKey = string;
type GuideId = string;
type DimensionId = string;
type ToolName = 'sketcheditor' | 'select' | 'shapes' | 'rect' | 'circle' | 'gear' | 'rack' | 'slot' | 'arcslot' | 'boltcircle' | 'arc' | 'poly' | 'push' | 'move' | 'rotate' | 'mirror' | 'guide' | 'guidecircle' | 'splitplane' | 'measure' | 'delete' | 'chamfer' | 'roundchamfer' | 'thread' | 'texture' | 'text' | 'mergefaces' | 'carve' | 'orbit';
type AxisName = 'free' | 'x' | 'y' | 'z';
type ObjectSelectionMode = 'object-group' | 'object' | 'group';
type ToolParameterUnit = 'mm' | 'deg' | 'count';
interface ToolParameterSpec { id: string; label: string; unit: ToolParameterUnit; signed?: boolean; }
interface ToolPointerInput { event: any; x: number; y: number; rawHit: HitResult | null; hit: HitResult | null; }
interface ToolController {
  name: ToolName;
  sketchHover?: boolean;
  navigation?: 'orbit';
  parameters: readonly ToolParameterSpec[];
  pointerDown?(input: ToolPointerInput): boolean | void;
  pointerMove?(input: ToolPointerInput): boolean | void;
  pointerUp?(input: ToolPointerInput): boolean | void;
  keyDown?(event: any): boolean | void;
  keyUp?(event: KeyboardEvent): void;
  numericSeed?(): boolean;
  numericPreview?(values: Record<string, number>): boolean | void;
  numericCommit?(values: Record<string, number>): boolean | void;
  cancel?(): void;
  cancelStep?(): boolean;
}

type EntityRef =
  | { kind: 'object'; objectId: ObjectId }
  | { kind: 'group'; groupId: GroupId }
  | { kind: 'face'; objectId: ObjectId; faceId: FaceId }
  | { kind: 'edge'; objectId: ObjectId; halfEdgeId: HalfEdgeId }
  | { kind: 'vertex'; objectId: ObjectId; vertexId: VertexId }
  | { kind: 'guide'; guideId: GuideId }
  | { kind: 'dimension'; dimensionId: DimensionId };

interface Plane { normal: Vec3; offset: number; }
interface Vertex { id: VertexId; position: Vec3; }
interface HalfEdge { id: HalfEdgeId; origin: VertexId; twin: HalfEdgeId; next: HalfEdgeId; prev: HalfEdgeId; loop: LoopId; face: FaceId; }
interface Loop { id: LoopId; firstHalfEdge: HalfEdgeId; kind: 'outer' | 'hole'; }
interface FaceProvenance { kind: 'primitive' | 'pushpull' | 'split' | 'import' | 'boolean'; label?: string; }
interface Face { id: FaceId; plane: Plane; outerLoop: LoopId; innerLoops: LoopId[]; material?: string; provenance?: FaceProvenance; boundaryGroup?: string; }
interface Transform { position: Vec3; rotation: Vec3; }
interface ObjectTransformState extends Transform {id:ObjectId;}
interface SolidMetadata { name?: string; }
interface Solid {
  id: string;
  vertices: Map<VertexId, Vertex>;
  halfEdges: Map<HalfEdgeId, HalfEdge>;
  loops: Map<LoopId, Loop>;
  faces: Map<FaceId, Face>;
  metadata: SolidMetadata;
}
type BooleanUnionResult =
  | { ok: true; solid: Solid }
  | { ok: false; reason: 'empty' | 'disconnected' | 'invalid'; message: string };

interface ThreadRimInfo {
  halfEdgeId: HalfEdgeId;
  halfEdgeIds: HalfEdgeId[];
  kind: 'internal' | 'external';
  center: Vec3;
  axis: Vec3;
  radius: number;
  maxLength: number;
  rimSegments: number;
  referenceRadial: Vec3;
}
type ThreadDirection = 'right' | 'left';
type ThreadOperation = 'add' | 'cut';
type SurfaceTextureType = 'lines' | 'crosshatch' | 'dots' | 'hex' | 'squares' | 'diamonds' | 'triangles' | 'stars' | 'slots' | 'chevrons' | 'pyramids' | 'beveltiles' | 'rooftiles';
type SurfaceTextureOperation = 'add' | 'cut';
type TextureBandAxis='x'|'y'|'z';
interface SurfaceTextureParameters { band?:{axis:TextureBandAxis;repeats:number;rows?:number}; type:SurfaceTextureType; operation:SurfaceTextureOperation; spacing:number; size:number; depth:number; angleDeg:number; margin:number; offsetX:number; offsetY:number; referencePoint?:Vec3; referenceU?:Vec3; projection?:PlaneBasis; boundaryFaceIds?:FaceId[]; }
interface SurfaceTexturePreview { basis:PlaneBasis; outlines:Vec2[][]; reliefLines?:Vec3[][]; previewTruncated?:boolean; instances:number; components:number; estimatedFaces:number; complexity:'Low'|'Medium'|'High'; }
interface SurfaceTexturePatchPreview { band?:{spacingAround:number;rows:number;referenceRadius:number}; faces:{faceId:FaceId;preview:SurfaceTexturePreview}[]; instances:number; components:number; estimatedFaces:number; complexity:'Low'|'Medium'|'High'; }
interface SurfaceTextureResult { solid:Solid; topology:TopologyMap; instances:number; components:number; }
interface CarveOutParameters { wallThickness:number; minimumInnerDetail:number; }
interface CarveOutStats { sourcePlanes:number; cavityPlanes:number; cavityVertices:number; cavityFaces:number; simplifiedPlanes:number; }
interface CarveOutResult { solid:Solid; stats:CarveOutStats; }

interface SerializedSolid {
  schema: 'brep-1';
  id: string;
  metadata: SolidMetadata;
  vertices: { id: VertexId; position: Vec3 }[];
  halfEdges: { id: HalfEdgeId; origin: VertexId; twin: HalfEdgeId; next: HalfEdgeId; prev: HalfEdgeId; loop: LoopId; face: FaceId }[];
  loops: { id: LoopId; firstHalfEdge: HalfEdgeId; kind: 'outer' | 'hole' }[];
  faces: { id: FaceId; plane: Plane; outerLoop: LoopId; innerLoops: LoopId[]; material?: string; provenance?: FaceProvenance; boundaryGroup?: string }[];
}
interface ProjectSolid {
  schema: 'poly-brep-1';
  id: string;
  metadata: SolidMetadata;
  vertices: { id: VertexId; position: Vec3 }[];
  faces: { id: FaceId; outer: VertexId[]; holes: VertexId[][]; material?: string; provenance?: FaceProvenance; boundaryGroup?: string }[];
}
interface GuidePoint { id: GuideId; kind: 'point'; point: Vec3; label?: string; }
interface GuideLine { id: GuideId; kind: 'line'; point: Vec3; direction: Vec3; planeNormal?: Vec3; label?: string; }
interface GuideCircle { id: GuideId; kind: 'circle'; center: Vec3; normal: Vec3; radius: number; label?: string; }
interface SplitSurfaceGrid {width:number;height:number;columns:number;rows:number;heights:number[];}
interface GuidePlane { id: GuideId; kind: 'plane'; origin: Vec3; normal: Vec3; axis?: Vec3; surface?: SplitSurfaceGrid; label?: string; }
type ConstructionGuide = GuidePoint | GuideLine | GuideCircle | GuidePlane;
type SerializedConstructionGuide = ConstructionGuide;
type GeometryAnchor =
  | { kind: 'world'; point: Vec3 }
  | { kind: 'vertex'; objectId: ObjectId; vertexId: VertexId; fallback: Vec3 }
  | { kind: 'edge'; objectId: ObjectId; vertexA: VertexId; vertexB: VertexId; t: number; fallback: Vec3 };
interface LinearDimension { id: DimensionId; kind: 'linear'; a: GeometryAnchor; b: GeometryAnchor; label?: string; }
type DimensionAnnotation = LinearDimension;
type SerializedDimensionAnnotation = DimensionAnnotation;
interface ObjectGroup { id: GroupId; name: string; objectIds: ObjectId[]; }
interface SerializedObjectGroup { id: GroupId; name: string; objectIds: ObjectId[]; }
interface BuildPlate { id:string; name:string; width:number; depth:number; x:number; y:number; color:string; opacity:number; visible:boolean; }
interface ModelDocument { buildPlates:BuildPlate[]; objects: ModelObject[]; groups: ObjectGroup[]; guides: ConstructionGuide[]; dimensions: DimensionAnnotation[]; selection: EntityRef | null; objectSelection: ObjectId[]; hover: EntityRef | null; }
interface DocumentSnapshot { buildPlates?:BuildPlate[]; nextBuildPlateId?:number; objects: SerializedModelObject[]; groups: SerializedObjectGroup[]; guides: SerializedConstructionGuide[]; dimensions: SerializedDimensionAnnotation[]; selection: EntityRef | null; objectSelection: ObjectId[]; projectName: string; nextObjectId: number; nextGroupId: number; nextGuideId: number; nextDimensionId: number; }
// Opaque handles: geometry copies stay private to their owning history store.
interface HistorySolidVersion { readonly kind:'history-solid-version'; }
interface SolidHistoryStore {
  capture(solid:Solid):HistorySolidVersion;
  matches(solid:Solid,version:HistorySolidVersion):boolean;
  restore(version:HistorySolidVersion):Solid;
}
interface HistoryModelObject extends Omit<SerializedModelObject,'solid'> { solid:HistorySolidVersion; }
interface HistoryDocumentState extends Omit<DocumentSnapshot,'objects'> { kind:'document-history'; objects:HistoryModelObject[]; }
interface CommandTopologyChange { objectId: ObjectId; topology: TopologyMap; }
interface CommandExecution<T = void> {
  value?: T;
  selection?: EntityRef | null;
  objectSelection?: ObjectId[];
  topology?: CommandTopologyChange;
  surfaceSketch?: FaceSketch | null;
}
interface DocumentCommand<T = void> {
  type: string;
  label: string;
  parameters: Record<string, unknown>;
  execute(): CommandExecution<T>;
}
interface HistoryEntry {
  type: string;
  label: string;
  parameters: Record<string, unknown>;
  before: DocumentSnapshot | HistoryDocumentState | ObjectColorHistoryState | ObjectShininessHistoryState;
  after: DocumentSnapshot | HistoryDocumentState | ObjectColorHistoryState | ObjectShininessHistoryState;
}
// Color-only history owns no topology, transforms or document organization.
interface ObjectColorHistoryState {
  kind: 'object-colors';
  colors: {objectId:ObjectId;color:string}[];
  selection: EntityRef | null;
  objectSelection: ObjectId[];
}
interface ObjectShininessHistoryState {
  kind:'object-shininess';
  values:{objectId:ObjectId;shininess:number}[];
  selection:EntityRef|null;
  objectSelection:ObjectId[];
}
interface ObjectPropertyEdit {
  name: string;
  dimensions: Vec3;
  position: Vec3;
  rotation: Vec3;
  color: string;
}
interface ModelObject {
  id: ObjectId;
  name: string;
  kind: 'solid' | 'surface';
  hidden?: boolean;
  locked?: boolean;
  color: string;
  shininess?: number;
  transform: Transform;
  solid: Solid;
}
interface SerializedModelObject { id:ObjectId; name:string; kind:'solid'|'surface'; hidden?:boolean; locked?:boolean; color:string; shininess?:number; transform:Transform; solid:SerializedSolid; }
interface ProjectModelObject { id:ObjectId; name:string; kind:'solid'|'surface'; hidden?:boolean; locked?:boolean; color:string; shininess?:number; transform:Transform; solid:ProjectSolid; }
interface ProjectData { references?:{buildPlates:BuildPlate[]}; format: 'lamjacraft-3d'; version: 7 | 8 | 9 | 10; units: 'mm'; name: string; objects: ProjectModelObject[]; groups?: SerializedObjectGroup[]; construction: { guides: SerializedConstructionGuide[] }; annotations: { dimensions: SerializedDimensionAnnotation[] }; }
interface Mesh { vertices: Vec3[]; triangles: [number, number, number][]; edges: [number, number][]; face: FaceId[]; }
interface Bounds3 { min: Vec3; max: Vec3; }
interface BVHNode extends Bounds3 { left?: BVHNode; right?: BVHNode; triangles?: number[]; }
type ModelViewStyle='modeling'|'illustration'|'presentation';
interface RenderCameraFrame {eye:Vec3;forward:Vec3;right:Vec3;up:Vec3;span:number;focal:number;}
interface SceneAppearance {normals:Vec3[];cornerNormals:Vec3[][];edges:{a:number;b:number;normals:Vec3[];sharp:boolean}[];}

interface SolidTopologyCounts {vertices:number;halfEdges:number;edges:number;loops:number;faces:number;holes:number;openEdges:number;}
interface SceneTopologyStats extends SolidTopologyCounts {triangles:number;bvhNodes:number;}
interface MeshCacheEntry { mesh: Mesh; bounds: Bounds3; bvh: BVHNode | null; }
interface Ray3 { origin: Vec3; dir: Vec3; }
interface SceneGeometryBuildRequest { kind: 'derive-object'; objectId: ObjectId; solid: SerializedSolid; transform: Transform; }
interface SceneGeometryBuildResult { kind: 'derived-object'; objectId: ObjectId; mesh: Mesh; bounds: Bounds3; bvh: BVHNode | null; }
type ProfileCategory = 'command' | 'preview' | 'geometry' | 'scene' | 'snap' | 'benchmark';
interface ProfilerNode { id:number; label:string; category:ProfileCategory; durationMs:number; startedAt:number; meta?:Record<string,unknown>; error?:string; children:ProfilerNode[]; }
interface BenchmarkResult { id:string; label:string; iterations:number; minMs:number; medianMs:number; meanMs:number; maxMs:number; error?:string; }
interface ProfilerAggregate { key:string; category:ProfileCategory; label:string; count:number; totalMs:number; maxMs:number; lastMs:number; lastAt:number; suppressed:number; }
interface PerformanceBenchmarkDefinition { id:string; label:string; iterations:number; run():void; }
interface ProfilerSnapshot { enabled:boolean; operations:ProfilerNode[]; aggregates:ProfilerAggregate[]; benchmarks:BenchmarkResult[]; retainedLimit:number; fastEventThresholdMs:number; }
interface ProfilerService {
  measure<T>(category:ProfileCategory,label:string,fn:()=>T,meta?:Record<string,unknown>):T;
  setEnabled(value:boolean):void;
  isEnabled():boolean;
  clear():void;
  snapshot():ProfilerSnapshot;
  setBenchmarks(results:BenchmarkResult[]):void;
  benchmarkResults():BenchmarkResult[];
}
interface SceneGeometryService {
  installLocalMesh(o:ModelObject,local:Mesh):void;
  rememberHistory(o:ModelObject,version:HistorySolidVersion):void;
  reuseHistory(o:ModelObject,version:HistorySolidVersion):boolean;
  appearance(mesh:Mesh):SceneAppearance;
  install(o:ModelObject,mesh:Mesh,bounds:Bounds3,appearance:SceneAppearance):void;
  mesh(o: ModelObject): Mesh;
  previewMesh(o: ModelObject, solid: Solid): Mesh;
  exportMesh(o: ModelObject): Mesh;
  entry(o: ModelObject): MeshCacheEntry;
  bvh(o: ModelObject): BVHNode | null;
  pick(objects: readonly ModelObject[], ray: Ray3): HitResult | null;
  pointVisible(objects: readonly ModelObject[], ray: Ray3, point:Vec3, preview?:(o:ModelObject)=>Solid|null):boolean;
  sceneBounds(objects: readonly ModelObject[]): Bounds3;
  topologyStats(objects:readonly ModelObject[],buildMissingBvh?:boolean):SceneTopologyStats;
  triangleCount(objects: readonly ModelObject[]): number;
  bvhNodeCount(objects: readonly ModelObject[], buildMissing?: boolean): number;
  invalidateObject(id: ObjectId): void;
  invalidateAll(): void;
  buildRequest(o: ModelObject): SceneGeometryBuildRequest;
  buildResult(o: ModelObject, includeBvh?: boolean): SceneGeometryBuildResult;
}
interface CameraState { target: Vec3; distance: number; yaw: number; pitch: number; orthographic: boolean; orthographicEyeDistance?: number; }
interface HitResult { id: ObjectId; face: FaceId; point: Vec3; localPoint: Vec3; t: number; }
interface SnapEdge { a: Vec3; b: Vec3; source?: EntityRef; }
interface SnapPointCandidate { point: Vec3; kind: 'Center'; source?: SnapSource; }
type SnapKind = 'Corner' | 'Center' | 'Midpoint' | 'On edge' | 'Guide point' | 'On guide line' | 'On guide circle' | 'Intersection' | 'Parallel' | 'Perpendicular' | 'On line';
type SnapSource = EntityRef | {kind:'circle-center'; objectId:ObjectId; faceId:FaceId} | {kind:'guide-intersection'; guideIds:GuideId[]} | {kind:'guide-edge-intersection'; guideId:GuideId; edge?:EntityRef} | {kind:'guide-segment'; guideId:GuideId; boundaryEdges:EntityRef[]};
interface SnapResult { point: Vec2; world: Vec3; kind: SnapKind; distance: number; source?: SnapSource; }
interface SnapPlane { point: Vec3; normal: Vec3; }
interface SnapInference { origin?: Vec3; referenceDirections?: Vec3[]; alignmentPoints?: Vec3[]; axes?: Vec3[]; }
// Opt-in requires immutable snapshots and an affine or pinhole projector whose
// third result is affine camera depth (the perspective pole is depth zero).
interface SnapSpatialQuery {projection:'affine'|'perspective';edges?:boolean;points?:boolean;}
interface SnapQuery { spatial?:SnapSpatialQuery; acceptEdge?:(edge:SnapEdge)=>boolean; acceptCandidate?:(world:Vec3,kind:SnapKind,source?:SnapSource)=>boolean; x:number; y:number; rawWorld:Vec3; edges:SnapEdge[]; points?:SnapPointCandidate[]; guides:ConstructionGuide[]; plane?:SnapPlane; project:(p:Vec3)=>[number,number,number]; radiusPx:number; geometryEnabled:boolean; guideEnabled:boolean; inferenceEnabled?:boolean; inference?:SnapInference; }
interface PlaneBasis { origin: Vec3; u: Vec3; v: Vec3; normal: Vec3; }
interface FaceSketch { objectId: ObjectId; supportFaceId: FaceId; basis: PlaneBasis; points: Vec2[]; kind: 'rectangle' | 'circle' | 'gear' | 'rack' | 'slot' | 'arcslot' | 'boltcircle' | 'polygon'; segments?: number; regionFaceId?: FaceId; }
interface TopologyMap { vertices: Map<VertexId, VertexId | null>; edges: Map<string, string | null>; faces: Map<FaceId, FaceId | null>; createdFaces: FaceId[]; }
interface SolidEditResult { solid: Solid; distance: number; limited: boolean; reason?: string; topology: TopologyMap; }
interface PolyFaceInput { points: Vec3[]; group?: string; provenance?: FaceProvenance; faceIdHint?: string; planeHint?:Plane; }
interface ModelingProgressUpdate { progress:number; message:string; }
type ModelingDiagnosticCategory='thread'|'rounded-chamfer'|'carve-out'|'texture'|'csg'|'brep'|'worker'|'import';
interface ModelingDiagnosticEvent { category:ModelingDiagnosticCategory; event:string; elapsedMs:number; data:Record<string,unknown>; }
type ModelingDiagnosticReporter=(category:ModelingDiagnosticCategory,event:string,data?:Record<string,unknown>)=>void;
declare const EDGE_FEATURE_WORKER_SOURCE:string;

function errorMessage(error:unknown):string{return error instanceof Error?error.message:String(error);}

const TOL = Object.freeze({
  weld: 1e-7,
  topologyKey: 1e-6,
  plane: 1e-6,
  coplanarAngle: 1e-8,
  coplanarDistance: 1e-6,
  minimumEdge: 1e-5,
  minimumFaceArea: 1e-8,
  snapGeometry: 1e-4,
  csg: 1e-7,
});
