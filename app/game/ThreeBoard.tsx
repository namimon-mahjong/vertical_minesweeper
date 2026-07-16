"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type BoardFacing = "north" | "east" | "south" | "west" | 0 | 1 | 2 | 3;

/** Cell coordinates are the world-space center of a unit block. */
export interface ThreeBoardCell {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Zero-based board layer: 0 is the bottom layer. */
  layer: number;
  mine?: boolean;
}

/** Surface coordinates are the exact world-space point on which the number sits. */
export interface ThreeBoardNumberSurface {
  id: string;
  x: number;
  y: number;
  z: number;
  value: number;
  /** Zero-based board layer: 0 is the bottom layer. */
  layer: number;
}

/** footY is the world-space height of the surface supporting the player. */
export interface ThreeBoardPlayer {
  x: number;
  z: number;
  footY: number;
  facing: BoardFacing;
}

export interface ThreeBoardProps {
  solidCells: readonly ThreeBoardCell[];
  flaggedCells: readonly ThreeBoardCell[];
  numberSurfaces: readonly ThreeBoardNumberSurface[];
  /** Shows the mine symbol on every remaining mine after a failed mission. */
  revealMineLocations?: boolean;
  player: ThreeBoardPlayer;
  cameraMode: ThreeBoardCameraMode;
  onCameraModeChange: (mode: ThreeBoardCameraMode) => void;
  validTargetIds: readonly string[] | ReadonlySet<string>;
  activeTargetId: string | null;
  onDig: (id: string) => void;
  onFlag: (id: string) => void;
  onHover: (id: string | null) => void;
  className?: string;
  style?: CSSProperties;
}

export type ThreeBoardCameraMode = "oblique" | "firstPerson";

interface DebrisParticle {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  age: number;
  lifetime: number;
  initialScale: number;
}

interface Runtime {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  obliqueCamera: THREE.OrthographicCamera;
  firstPersonCamera: THREE.PerspectiveCamera;
  activeCamera: THREE.Camera;
  controls: OrbitControls;
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
  groundGroup: THREE.Group;
  solidGroup: THREE.Group;
  debrisGroup: THREE.Group;
  flagGroup: THREE.Group;
  numberGroup: THREE.Group;
  playerGroup: THREE.Group;
  blockGeometry: THREE.BoxGeometry;
  blockEdgeGeometry: THREE.EdgesGeometry;
  debrisGeometry: THREE.BoxGeometry;
  debrisMaterials: THREE.MeshStandardMaterial[];
  debris: DebrisParticle[];
  mineMarkerGeometry: THREE.PlaneGeometry;
  cellMeshes: Map<string, THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>>;
  targetMeshes: Map<string, THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>>;
  validTargets: Set<string>;
  flaggedIds: Set<string>;
  activeTargetId: string | null;
  center: THREE.Vector3;
  span: number;
  aspect: number;
  fitted: boolean;
  hoveredId: string | null;
}

const COLORS = {
  block: 0x41677d,
  valid: 0xe3b64c,
  validEmissive: 0x6b4606,
  active: 0x55ead2,
  activeEmissive: 0x0b685e,
  flaggedBlock: 0x9b2948,
  flaggedEmissive: 0x5d102a,
  player: 0x68e1cf,
  playerDark: 0x123d4b,
  flag: 0xff5274,
  flagPole: 0xe9f4f8,
} as const;

const containerStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  minHeight: 480,
  overflow: "hidden",
  background: "#07131f",
};

const viewportStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
};

const cameraPanelStyle: CSSProperties = {
  position: "absolute",
  top: 14,
  right: 14,
  zIndex: 2,
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: 6,
  border: "1px solid rgba(142, 177, 196, .35)",
  borderRadius: 8,
  background: "rgba(5, 18, 30, .82)",
  boxShadow: "0 8px 24px rgba(0, 0, 0, .24)",
  color: "#eaf6ff",
  font: "600 11px/1 Arial, sans-serif",
  letterSpacing: ".05em",
};

const baseButtonStyle: CSSProperties = {
  minWidth: 34,
  height: 32,
  padding: "0 10px",
  border: "1px solid #456078",
  borderRadius: 5,
  background: "#102438",
  color: "#dcecf3",
  cursor: "pointer",
  font: "700 11px/1 Arial, sans-serif",
};

function disposeMaterial(material: THREE.Material): void {
  const candidate = material as THREE.Material & {
    map?: THREE.Texture | null;
    alphaMap?: THREE.Texture | null;
  };
  candidate.map?.dispose();
  candidate.alphaMap?.dispose();
  material.dispose();
}

function clearGroup(group: THREE.Group, disposeGeometry: boolean): void {
  for (const child of [...group.children]) {
    child.traverse((object) => {
      const renderable = object as THREE.Mesh | THREE.Sprite;
      if (disposeGeometry && "geometry" in renderable && renderable.geometry) {
        renderable.geometry.dispose();
      }
      if ("material" in renderable && renderable.material) {
        const materials = Array.isArray(renderable.material)
          ? renderable.material
          : [renderable.material];
        for (const material of materials) disposeMaterial(material);
      }
    });
    group.remove(child);
  }
}

function setFrustum(camera: THREE.OrthographicCamera, aspect: number, span: number): void {
  const safeAspect = Math.max(aspect, 0.01);
  const halfWidth = safeAspect >= 1 ? (span * safeAspect) / 2 : span / 2;
  const halfHeight = safeAspect >= 1 ? span / 2 : span / (2 * safeAspect);
  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
}

function fitRuntime(runtime: Runtime, cells: readonly ThreeBoardCell[]): void {
  if (runtime.fitted || cells.length === 0) return;

  const minX = Math.min(...cells.map((cell) => cell.x));
  const maxX = Math.max(...cells.map((cell) => cell.x));
  const minY = Math.min(...cells.map((cell) => cell.y));
  const maxY = Math.max(...cells.map((cell) => cell.y));
  const minZ = Math.min(...cells.map((cell) => cell.z));
  const maxZ = Math.max(...cells.map((cell) => cell.z));
  const width = maxX - minX + 1;
  const depth = maxZ - minZ + 1;
  const height = maxY - minY + 1;

  runtime.center.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  runtime.span = Math.max(width + 2.4, depth + 2.4, height * 1.25 + 3, 7);
  setFrustum(runtime.obliqueCamera, runtime.aspect, runtime.span);

  runtime.obliqueCamera.position.copy(runtime.center).add(
    new THREE.Vector3(runtime.span * 0.78, runtime.span * 0.88, runtime.span * 0.92),
  );
  runtime.obliqueCamera.up.set(0, 1, 0);
  runtime.controls.target.copy(runtime.center);
  runtime.obliqueCamera.lookAt(runtime.center);
  runtime.controls.update();
  runtime.fitted = true;
}

function buildGround(runtime: Runtime, cells: readonly ThreeBoardCell[]): void {
  if (runtime.groundGroup.children.length > 0 || cells.length === 0) return;

  const minX = Math.min(...cells.map((cell) => cell.x));
  const maxX = Math.max(...cells.map((cell) => cell.x));
  const minZ = Math.min(...cells.map((cell) => cell.z));
  const maxZ = Math.max(...cells.map((cell) => cell.z));
  const width = maxX - minX + 3;
  const depth = maxZ - minZ + 3;
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;

  const geometry = new THREE.BoxGeometry(width, 0.18, depth);
  const slab = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: 0x0b2836,
      emissive: 0x071a24,
      emissiveIntensity: 0.18,
      roughness: 0.92,
      metalness: 0.02,
    }),
  );
  // The slab top is y=0, flush with the underside of the bottom blocks.
  slab.position.set(centerX, -0.09, centerZ);
  const rim = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: LAYER_COLORS[0], transparent: true, opacity: 0.7 }),
  );
  slab.add(rim);
  runtime.groundGroup.add(slab);

  const gridSize = Math.max(width, depth);
  const grid = new THREE.GridHelper(gridSize, Math.round(gridSize), 0x4dd7ff, 0x173f4e);
  grid.position.set(centerX, 0.003, centerZ);
  runtime.groundGroup.add(grid);
}

function applyCellAppearance(runtime: Runtime): void {
  runtime.targetMeshes.clear();
  for (const [id, mesh] of runtime.cellMeshes) {
    const valid = runtime.validTargets.has(id);
    const active = valid && runtime.activeTargetId === id;
    const flagged = runtime.flaggedIds.has(id);
    const material = mesh.material;

    material.color.setHex(
      flagged ? COLORS.flaggedBlock : active ? COLORS.active : valid ? COLORS.valid : COLORS.block,
    );
    material.emissive.setHex(
      flagged
        ? COLORS.flaggedEmissive
        : active
          ? COLORS.activeEmissive
          : valid
            ? COLORS.validEmissive
            : 0x000000,
    );
    material.emissiveIntensity = flagged ? 0.62 : active ? 0.72 : valid ? 0.46 : 0;
    mesh.scale.setScalar(active ? 1.045 : valid ? 1.018 : 1);
    if (valid) runtime.targetMeshes.set(id, mesh);
  }
}

const LAYER_COLORS = ["#4dd7ff", "#f6c453", "#ff6f91"] as const;

function layerColor(layer: number): (typeof LAYER_COLORS)[number] {
  return LAYER_COLORS[Math.max(0, Math.min(LAYER_COLORS.length - 1, layer))];
}

function makeNumberTexture(value: number, layer: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);

  context.clearRect(0, 0, 128, 128);
  context.beginPath();
  context.arc(64, 64, 42, 0, Math.PI * 2);
  context.fillStyle = "rgba(3, 14, 24, .78)";
  context.fill();
  context.lineWidth = 5;
  const markerColor = layerColor(layer);
  context.strokeStyle = markerColor;
  context.stroke();
  context.fillStyle = markerColor;
  context.font = "900 72px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(value), 64, 68);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function spawnBlockDebris(runtime: Runtime, cell: ThreeBoardCell): void {
  const material = runtime.debrisMaterials[
    Math.max(0, Math.min(runtime.debrisMaterials.length - 1, cell.layer))
  ];
  for (let index = 0; index < 18; index += 1) {
    const mesh = new THREE.Mesh(runtime.debrisGeometry, material);
    mesh.position.set(
      cell.x + (Math.random() - 0.5) * 0.58,
      cell.y + (Math.random() - 0.5) * 0.58,
      cell.z + (Math.random() - 0.5) * 0.58,
    );
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    const initialScale = 0.7 + Math.random() * 0.7;
    mesh.scale.setScalar(initialScale);
    runtime.debrisGroup.add(mesh);
    runtime.debris.push({
      mesh,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 4,
        2 + Math.random() * 3,
        (Math.random() - 0.5) * 4,
      ),
      angularVelocity: new THREE.Vector3(
        (Math.random() - 0.5) * 9,
        (Math.random() - 0.5) * 9,
        (Math.random() - 0.5) * 9,
      ),
      age: 0,
      lifetime: 1.55 + Math.random() * 0.65,
      initialScale,
    });
  }

  while (runtime.debris.length > 700) {
    const oldest = runtime.debris.shift();
    if (oldest) runtime.debrisGroup.remove(oldest.mesh);
  }
}

function updateDebris(runtime: Runtime, delta: number): void {
  for (let index = runtime.debris.length - 1; index >= 0; index -= 1) {
    const particle = runtime.debris[index];
    particle.age += delta;
    if (particle.age >= particle.lifetime) {
      runtime.debrisGroup.remove(particle.mesh);
      runtime.debris.splice(index, 1);
      continue;
    }
    particle.velocity.y -= 5.8 * delta;
    particle.mesh.position.addScaledVector(particle.velocity, delta);
    particle.mesh.rotation.x += particle.angularVelocity.x * delta;
    particle.mesh.rotation.y += particle.angularVelocity.y * delta;
    particle.mesh.rotation.z += particle.angularVelocity.z * delta;
    const remaining = Math.max(0, 1 - particle.age / particle.lifetime);
    particle.mesh.scale.setScalar(particle.initialScale * remaining);
  }
}

function makeMineUndersideTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);

  context.clearRect(0, 0, 128, 128);
  context.beginPath();
  context.arc(64, 64, 54, 0, Math.PI * 2);
  context.fillStyle = "#ff5274";
  context.fill();
  context.lineWidth = 8;
  context.strokeStyle = "#ffd5de";
  context.stroke();
  context.beginPath();
  context.arc(61, 70, 29, 0, Math.PI * 2);
  context.fillStyle = "#07131f";
  context.fill();
  context.lineWidth = 8;
  context.strokeStyle = "#07131f";
  context.beginPath();
  context.moveTo(75, 45);
  context.quadraticCurveTo(88, 25, 101, 39);
  context.stroke();
  context.fillStyle = "#f6c453";
  context.beginPath();
  context.arc(103, 37, 7, 0, Math.PI * 2);
  context.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function normalizeFacing(facing: BoardFacing): Exclude<BoardFacing, number> {
  return typeof facing === "number"
    ? (["north", "east", "south", "west"] as const)[((facing % 4) + 4) % 4]
    : facing;
}

function facingVector(facing: BoardFacing): Readonly<{ x: number; z: number }> {
  return {
    north: { x: 0, z: -1 },
    east: { x: 1, z: 0 },
    south: { x: 0, z: 1 },
    west: { x: -1, z: 0 },
  }[normalizeFacing(facing)];
}

function updateFirstPersonCamera(runtime: Runtime, player: ThreeBoardPlayer): void {
  const vector = facingVector(player.facing);
  runtime.firstPersonCamera.position.set(player.x, player.footY + 0.78, player.z);
  runtime.firstPersonCamera.up.set(0, 1, 0);
  runtime.firstPersonCamera.lookAt(
    player.x + vector.x,
    player.footY + 0.7,
    player.z + vector.z,
  );
  runtime.firstPersonCamera.updateMatrixWorld();
}

function facingAngle(facing: BoardFacing): number {
  return { north: 0, east: -Math.PI / 2, south: Math.PI, west: Math.PI / 2 }[
    normalizeFacing(facing)
  ];
}

function makePlayerMaterial(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.58,
    metalness: 0.05,
    depthTest: false,
    depthWrite: false,
  });
}

function addPlayerPart(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.renderOrder = 1000;
  group.add(mesh);
  return mesh;
}

export default function ThreeBoard({
  solidCells,
  flaggedCells,
  numberSurfaces,
  revealMineLocations = false,
  player,
  cameraMode,
  onCameraModeChange,
  validTargetIds,
  activeTargetId,
  onDig,
  onFlag,
  onHover,
  className,
  style,
}: ThreeBoardProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const callbacksRef = useRef({ onDig, onFlag, onHover });
  const previousSolidCellsRef = useRef<ReadonlyMap<string, ThreeBoardCell> | null>(null);

  useEffect(() => {
    callbacksRef.current = { onDig, onFlag, onHover };
  }, [onDig, onFlag, onHover]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07131f);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = "none";
    viewport.appendChild(renderer.domElement);

    const obliqueCamera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.05, 200);
    const firstPersonCamera = new THREE.PerspectiveCamera(68, 1, 0.04, 80);
    const controls = new OrbitControls(obliqueCamera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.minZoom = 0.7;
    controls.maxZoom = 2.6;
    controls.minPolarAngle = Math.PI * 0.16;
    controls.maxPolarAngle = Math.PI * 0.47;

    const groundGroup = new THREE.Group();
    const solidGroup = new THREE.Group();
    const debrisGroup = new THREE.Group();
    const flagGroup = new THREE.Group();
    const numberGroup = new THREE.Group();
    const playerGroup = new THREE.Group();
    scene.add(groundGroup, solidGroup, debrisGroup, flagGroup, numberGroup, playerGroup);
    scene.add(new THREE.HemisphereLight(0xc5ecff, 0x102432, 1.55));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
    keyLight.position.set(7, 13, 9);
    scene.add(keyLight);

    const blockGeometry = new THREE.BoxGeometry(0.94, 1, 0.94);
    const runtime: Runtime = {
      scene,
      renderer,
      obliqueCamera,
      firstPersonCamera,
      activeCamera: obliqueCamera,
      controls,
      raycaster: new THREE.Raycaster(),
      pointer: new THREE.Vector2(),
      groundGroup,
      solidGroup,
      debrisGroup,
      flagGroup,
      numberGroup,
      playerGroup,
      // Full unit height keeps vertically adjacent layers flush. The horizontal
      // clearance remains so individual cells are still readable from above.
      blockGeometry,
      blockEdgeGeometry: new THREE.EdgesGeometry(blockGeometry),
      debrisGeometry: new THREE.BoxGeometry(0.17, 0.17, 0.17),
      debrisMaterials: LAYER_COLORS.map(
        (color) =>
          new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: 0.28,
            roughness: 0.66,
            metalness: 0.04,
          }),
      ),
      debris: [],
      mineMarkerGeometry: new THREE.PlaneGeometry(0.72, 0.72),
      cellMeshes: new Map(),
      targetMeshes: new Map(),
      validTargets: new Set(),
      flaggedIds: new Set(),
      activeTargetId: null,
      center: new THREE.Vector3(),
      span: 8,
      aspect: 1,
      fitted: false,
      hoveredId: null,
    };
    runtimeRef.current = runtime;

    const resize = () => {
      const width = Math.max(viewport.clientWidth, 1);
      const height = Math.max(viewport.clientHeight, 1);
      runtime.aspect = width / height;
      renderer.setSize(width, height, false);
      setFrustum(obliqueCamera, runtime.aspect, runtime.span);
      firstPersonCamera.aspect = runtime.aspect;
      firstPersonCamera.updateProjectionMatrix();
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(viewport);

    const targetAt = (event: PointerEvent): string | null => {
      const bounds = renderer.domElement.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return null;
      runtime.pointer.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      runtime.raycaster.setFromCamera(runtime.pointer, runtime.activeCamera);
      const hits = runtime.raycaster.intersectObjects([...runtime.targetMeshes.values()], false);
      return (hits[0]?.object.userData.cellId as string | undefined) ?? null;
    };

    let pointerDown: { x: number; y: number; button: number } | null = null;
    const handlePointerDown = (event: PointerEvent) => {
      pointerDown = { x: event.clientX, y: event.clientY, button: event.button };
    };
    const handlePointerMove = (event: PointerEvent) => {
      const id = targetAt(event);
      if (id === runtime.hoveredId) return;
      runtime.hoveredId = id;
      renderer.domElement.style.cursor =
        id ? "pointer" : runtime.activeCamera === runtime.obliqueCamera ? "grab" : "default";
      callbacksRef.current.onHover(id);
    };
    const handlePointerUp = (event: PointerEvent) => {
      const down = pointerDown;
      pointerDown = null;
      if (!down || down.button !== event.button) return;
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
      const id = targetAt(event);
      if (!id) return;
      if (event.button === 0) callbacksRef.current.onDig(id);
      if (event.button === 2) callbacksRef.current.onFlag(id);
    };
    const handlePointerLeave = () => {
      pointerDown = null;
      if (runtime.hoveredId === null) return;
      runtime.hoveredId = null;
      callbacksRef.current.onHover(null);
    };
    const handleContextMenu = (event: MouseEvent) => event.preventDefault();
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("pointerleave", handlePointerLeave);
    renderer.domElement.addEventListener("contextmenu", handleContextMenu);

    let animationFrame = 0;
    const clock = new THREE.Clock();
    const render = () => {
      animationFrame = window.requestAnimationFrame(render);
      updateDebris(runtime, Math.min(clock.getDelta(), 0.05));
      if (runtime.activeCamera === runtime.obliqueCamera) controls.update();
      renderer.render(scene, runtime.activeCamera);
    };
    render();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("pointerleave", handlePointerLeave);
      renderer.domElement.removeEventListener("contextmenu", handleContextMenu);
      controls.dispose();
      clearGroup(groundGroup, true);
      clearGroup(solidGroup, false);
      clearGroup(flagGroup, true);
      clearGroup(numberGroup, false);
      clearGroup(playerGroup, true);
      debrisGroup.clear();
      runtime.blockGeometry.dispose();
      runtime.blockEdgeGeometry.dispose();
      runtime.debrisGeometry.dispose();
      for (const material of runtime.debrisMaterials) material.dispose();
      runtime.mineMarkerGeometry.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    const currentCells = new Map(solidCells.map((cell) => [cell.id, cell]));
    const previousCells = previousSolidCellsRef.current;
    if (previousCells) {
      for (const [id, cell] of previousCells) {
        if (!currentCells.has(id)) spawnBlockDebris(runtime, cell);
      }
    }
    previousSolidCellsRef.current = currentCells;

    buildGround(runtime, solidCells);
    clearGroup(runtime.solidGroup, false);
    runtime.cellMeshes.clear();
    for (const cell of solidCells) {
      const material = new THREE.MeshStandardMaterial({
        color: COLORS.block,
        emissive: 0x000000,
        roughness: 0.78,
        metalness: 0.03,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      const mesh = new THREE.Mesh(runtime.blockGeometry, material);
      mesh.position.set(cell.x, cell.y, cell.z);
      mesh.userData.cellId = cell.id;
      const outline = new THREE.LineSegments(
        runtime.blockEdgeGeometry,
        new THREE.LineBasicMaterial({
          color: layerColor(cell.layer),
          transparent: true,
          opacity: 0.88,
          toneMapped: false,
        }),
      );
      outline.renderOrder = 2;
      mesh.add(outline);
      if (cell.mine) {
        const mineMarker = new THREE.Mesh(
          runtime.mineMarkerGeometry,
          new THREE.MeshBasicMaterial({
            map: makeMineUndersideTexture(),
            transparent: true,
            side: THREE.FrontSide,
            depthWrite: false,
            toneMapped: false,
          }),
        );
        mineMarker.position.y = -0.501;
        mineMarker.rotation.x = Math.PI / 2;
        mesh.add(mineMarker);

        if (revealMineLocations) {
          const revealedMineMarker = new THREE.Mesh(
            runtime.mineMarkerGeometry,
            new THREE.MeshBasicMaterial({
              map: makeMineUndersideTexture(),
              transparent: true,
              side: THREE.FrontSide,
              depthWrite: false,
              toneMapped: false,
            }),
          );
          revealedMineMarker.position.y = 0.501;
          revealedMineMarker.rotation.x = -Math.PI / 2;
          revealedMineMarker.renderOrder = 3;
          mesh.add(revealedMineMarker);
        }
      }
      runtime.solidGroup.add(mesh);
      runtime.cellMeshes.set(cell.id, mesh);
    }
    fitRuntime(runtime, solidCells);
    applyCellAppearance(runtime);
  }, [solidCells, revealMineLocations]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.validTargets = new Set(validTargetIds);
    runtime.activeTargetId = activeTargetId;
    applyCellAppearance(runtime);

    if (runtime.hoveredId && !runtime.validTargets.has(runtime.hoveredId)) {
      runtime.hoveredId = null;
      callbacksRef.current.onHover(null);
    }
  }, [validTargetIds, activeTargetId]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    clearGroup(runtime.flagGroup, true);
    runtime.flaggedIds = new Set(flaggedCells.map((cell) => cell.id));
    applyCellAppearance(runtime);

    for (const cell of flaggedCells) {
      if (!runtime.cellMeshes.has(cell.id)) continue;
      const flag = new THREE.Group();
      flag.position.set(cell.x, cell.y + 0.501, cell.z);

      addPlayerPart(
        flag,
        new THREE.CylinderGeometry(0.025, 0.025, 0.56, 8),
        new THREE.MeshStandardMaterial({ color: COLORS.flagPole, roughness: 0.5 }),
        [0, 0.28, 0],
      );
      const pennant = new THREE.Mesh(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, 0.27, 0),
          new THREE.Vector3(0.34, 0.19, 0),
        ]),
        new THREE.MeshBasicMaterial({ color: COLORS.flag, side: THREE.DoubleSide }),
      );
      pennant.position.y = 0.38;
      flag.add(pennant);
      runtime.flagGroup.add(flag);
    }
  }, [flaggedCells, solidCells]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    clearGroup(runtime.numberGroup, false);

    for (const surface of numberSurfaces) {
      if (surface.value <= 0) continue;
      const material = new THREE.SpriteMaterial({
        map: makeNumberTexture(surface.value, surface.layer),
        transparent: true,
        depthTest: false,
        depthWrite: false,
        sizeAttenuation: true,
      });
      const sprite = new THREE.Sprite(material);
      // A camera-facing sprite needs a little clearance from the horizontal
      // surface; otherwise its lower half intersects the block in oblique view.
      sprite.position.set(surface.x, surface.y + 0.18, surface.z);
      sprite.scale.set(0.68, 0.68, 1);
      sprite.renderOrder = 20;
      runtime.numberGroup.add(sprite);
    }
  }, [numberSurfaces]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    clearGroup(runtime.playerGroup, true);

    const dummy = new THREE.Group();
    const suit = makePlayerMaterial(COLORS.player);
    const dark = makePlayerMaterial(COLORS.playerDark);
    const accent = makePlayerMaterial(0xf3c457);

    addPlayerPart(dummy, new THREE.CapsuleGeometry(0.19, 0.38, 6, 12), suit, [0, 0.47, 0]);
    addPlayerPart(dummy, new THREE.SphereGeometry(0.18, 16, 12), suit.clone(), [0, 0.9, 0]);
    addPlayerPart(
      dummy,
      new THREE.RingGeometry(0.22, 0.3, 24),
      new THREE.MeshBasicMaterial({ color: 0xf3f8fa, side: THREE.DoubleSide }),
      [0, 1.12, 0],
      [-Math.PI / 2, 0, 0],
    );
    addPlayerPart(dummy, new THREE.BoxGeometry(0.22, 0.08, 0.035), dark, [0, 0.92, -0.165]);
    addPlayerPart(
      dummy,
      new THREE.CylinderGeometry(0.055, 0.055, 0.34, 8),
      suit.clone(),
      [-0.12, 0.18, 0],
    );
    addPlayerPart(
      dummy,
      new THREE.CylinderGeometry(0.055, 0.055, 0.34, 8),
      suit.clone(),
      [0.12, 0.18, 0],
    );
    addPlayerPart(
      dummy,
      new THREE.ConeGeometry(0.13, 0.3, 4),
      accent,
      [0, 0.49, -0.49],
      [-Math.PI / 2, 0, 0],
    );

    dummy.position.set(player.x, player.footY + 0.02, player.z);
    dummy.rotation.y = facingAngle(player.facing);
    dummy.traverse((object) => {
      object.renderOrder = 1000;
      const renderable = object as THREE.Mesh;
      if (renderable.material) {
        const materials = Array.isArray(renderable.material)
          ? renderable.material
          : [renderable.material];
        for (const material of materials) {
          material.depthTest = false;
          material.depthWrite = false;
        }
      }
    });
    runtime.playerGroup.add(dummy);
    updateFirstPersonCamera(runtime, player);
    runtime.playerGroup.visible = runtime.activeCamera !== runtime.firstPersonCamera;
  }, [player]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.activeCamera =
      cameraMode === "firstPerson" ? runtime.firstPersonCamera : runtime.obliqueCamera;
    runtime.controls.enabled = cameraMode === "oblique";
    runtime.playerGroup.visible = cameraMode !== "firstPerson";
    runtime.renderer.domElement.style.cursor = cameraMode === "oblique" ? "grab" : "default";
    if (runtime.hoveredId !== null) {
      runtime.hoveredId = null;
      callbacksRef.current.onHover(null);
    }
  }, [cameraMode]);

  const rotateOblique = (direction: -1 | 1) => {
    const runtime = runtimeRef.current;
    if (!runtime || cameraMode !== "oblique") return;
    const offset = runtime.obliqueCamera.position.clone().sub(runtime.controls.target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), direction * (Math.PI / 4));
    runtime.obliqueCamera.position.copy(runtime.controls.target).add(offset);
    runtime.obliqueCamera.lookAt(runtime.controls.target);
    runtime.controls.update();
  };

  return (
    <div className={className} style={{ ...containerStyle, ...style }}>
      <div ref={viewportRef} style={viewportStyle} aria-label="3D minefield" />
      <div style={cameraPanelStyle} role="group" aria-label="Camera controls">
        <button
          type="button"
          aria-pressed={cameraMode === "oblique"}
          onClick={() => onCameraModeChange("oblique")}
          style={{
            ...baseButtonStyle,
            borderColor: cameraMode === "oblique" ? "#55ead2" : "#456078",
            color: cameraMode === "oblique" ? "#55ead2" : "#dcecf3",
          }}
        >
          3D
        </button>
        <button
          type="button"
          aria-pressed={cameraMode === "firstPerson"}
          aria-label="First-person camera"
          onClick={() => onCameraModeChange("firstPerson")}
          style={{
            ...baseButtonStyle,
            borderColor: cameraMode === "firstPerson" ? "#55ead2" : "#456078",
            color: cameraMode === "firstPerson" ? "#55ead2" : "#dcecf3",
          }}
        >
          FP
        </button>
        {cameraMode === "oblique" && (
          <>
            <button
              type="button"
              onClick={() => rotateOblique(-1)}
              aria-label="Rotate camera left 45 degrees"
              title="Rotate left"
              style={baseButtonStyle}
            >
              ↺
            </button>
            <button
              type="button"
              onClick={() => rotateOblique(1)}
              aria-label="Rotate camera right 45 degrees"
              title="Rotate right"
              style={baseButtonStyle}
            >
              ↻
            </button>
          </>
        )}
      </div>
    </div>
  );
}
