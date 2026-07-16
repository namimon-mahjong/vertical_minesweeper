/** Framework-independent rules for the layered minesweeper board. */

export const DEFAULT_BOARD_SIZE = { width: 7, depth: 7, layers: 3 } as const;

export type Direction = "north" | "east" | "south" | "west";
export type TargetKind =
  | "front"
  | "down"
  | "frontDown"
  | "rightDown"
  | "backDown"
  | "leftDown";
export type GameStatus = "playing" | "won" | "lost";

export interface Coord {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface BoardSize {
  readonly width: number;
  readonly depth: number;
  readonly layers: number;
}

export interface Player {
  readonly x: number;
  readonly z: number;
  /** Height of the surface beneath the player's feet (0 is the bottom floor). */
  readonly footY: number;
  readonly facing: Direction;
}

export interface Cell extends Coord {
  readonly mine: boolean;
  readonly solid: boolean;
  readonly flagged: boolean;
}

export interface GameSetup {
  readonly size: BoardSize;
  readonly mines: readonly Coord[];
  readonly initialPlayer: Player;
}

export interface GameState {
  readonly size: BoardSize;
  readonly cells: readonly Cell[];
  readonly player: Player;
  readonly activeTarget: TargetKind | null;
  readonly status: GameStatus;
  readonly exploded: Coord | null;
  /** Immutable reset data retained so restart is deterministic. */
  readonly setup: GameSetup;
}

export interface DigTarget {
  readonly kind: TargetKind;
  readonly coord: Coord;
  readonly cell: Cell;
}

export interface VisibleClue {
  /** Removed cell whose same-layer neighbours are counted. */
  readonly coord: Coord;
  /** World-space height at which the label belongs. */
  readonly surfaceY: number;
  readonly count: number;
}

export interface CreateGameOptions {
  readonly size?: Partial<BoardSize>;
  /** Explicit fixed mine fixture. When omitted, a seeded layout is generated. */
  readonly mines?: readonly Coord[];
  readonly mineCount?: number;
  readonly seed?: number;
  readonly player?: Partial<Pick<Player, "x" | "z" | "facing">>;
}

export type GameAction =
  | { readonly type: "move"; readonly direction: Direction }
  | { readonly type: "selectTarget"; readonly target: TargetKind | Coord }
  | { readonly type: "cycleTarget"; readonly step?: 1 | -1 }
  | { readonly type: "dig"; readonly target?: TargetKind | Coord }
  | { readonly type: "flag"; readonly target?: TargetKind | Coord }
  | { readonly type: "restart" };

const SURROUNDING_GROUND_TARGETS: readonly TargetKind[] = [
  "frontDown",
  "rightDown",
  "backDown",
  "leftDown",
];

const TARGET_ORDER: readonly TargetKind[] = [
  ...SURROUNDING_GROUND_TARGETS,
  "front",
  "down",
];

const DIRECTION_VECTOR: Readonly<Record<Direction, Readonly<{ x: number; z: number }>>> = {
  north: { x: 0, z: -1 },
  east: { x: 1, z: 0 },
  south: { x: 0, z: 1 },
  west: { x: -1, z: 0 },
};

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function sameCoord(a: Coord, b: Coord): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

export function isInBounds(size: BoardSize, coord: Coord): boolean {
  return (
    Number.isInteger(coord.x) &&
    Number.isInteger(coord.y) &&
    Number.isInteger(coord.z) &&
    coord.x >= 0 &&
    coord.x < size.width &&
    coord.z >= 0 &&
    coord.z < size.depth &&
    coord.y >= 0 &&
    coord.y < size.layers
  );
}

function cellIndex(size: BoardSize, coord: Coord): number {
  return (coord.y * size.depth + coord.z) * size.width + coord.x;
}

export function getCell(state: Pick<GameState, "size" | "cells">, coord: Coord): Cell | null {
  return isInBounds(state.size, coord) ? state.cells[cellIndex(state.size, coord)] ?? null : null;
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function generateMines(size: BoardSize, requestedCount: number, seed: number): Coord[] {
  const coords: Coord[] = [];
  for (let y = 0; y < size.layers; y += 1) {
    for (let z = 0; z < size.depth; z += 1) {
      for (let x = 0; x < size.width; x += 1) coords.push({ x, y, z });
    }
  }
  const random = seededRandom(seed);
  for (let index = coords.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [coords[index], coords[swapIndex]] = [coords[swapIndex], coords[index]];
  }
  return coords.slice(0, Math.max(0, Math.min(requestedCount, coords.length)));
}

function validateSetup(setup: GameSetup): void {
  assertPositiveInteger(setup.size.width, "width");
  assertPositiveInteger(setup.size.depth, "depth");
  assertPositiveInteger(setup.size.layers, "layers");
  if (
    !Number.isInteger(setup.initialPlayer.x) ||
    !Number.isInteger(setup.initialPlayer.z) ||
    setup.initialPlayer.x < 0 ||
    setup.initialPlayer.x >= setup.size.width ||
    setup.initialPlayer.z < 0 ||
    setup.initialPlayer.z >= setup.size.depth ||
    setup.initialPlayer.footY !== setup.size.layers
  ) {
    throw new RangeError("The initial player must stand on the fully filled top layer");
  }
  const seen = new Set<string>();
  for (const mine of setup.mines) {
    if (!isInBounds(setup.size, mine)) throw new RangeError("Mine coordinate is out of bounds");
    const key = `${mine.x},${mine.y},${mine.z}`;
    if (seen.has(key)) throw new RangeError("Mine coordinates must be unique");
    seen.add(key);
  }
}

function buildInitialState(setup: GameSetup): GameState {
  const mineKeys = new Set(setup.mines.map((mine) => `${mine.x},${mine.y},${mine.z}`));
  const cells: Cell[] = [];
  for (let y = 0; y < setup.size.layers; y += 1) {
    for (let z = 0; z < setup.size.depth; z += 1) {
      for (let x = 0; x < setup.size.width; x += 1) {
        cells.push({ x, y, z, mine: mineKeys.has(`${x},${y},${z}`), solid: true, flagged: false });
      }
    }
  }
  const state: GameState = {
    size: setup.size,
    cells,
    player: setup.initialPlayer,
    activeTarget: null,
    status: "playing",
    exploded: null,
    setup,
  };
  return refreshActiveTarget(state);
}

export function createGame(options: CreateGameOptions = {}): GameState {
  const size: BoardSize = {
    width: options.size?.width ?? DEFAULT_BOARD_SIZE.width,
    depth: options.size?.depth ?? DEFAULT_BOARD_SIZE.depth,
    layers: options.size?.layers ?? DEFAULT_BOARD_SIZE.layers,
  };
  assertPositiveInteger(size.width, "width");
  assertPositiveInteger(size.depth, "depth");
  assertPositiveInteger(size.layers, "layers");
  const mineCount = options.mineCount ?? Math.max(1, Math.round(size.width * size.depth * size.layers * 0.12));
  const mines = options.mines
    ? options.mines.map((mine) => ({ ...mine }))
    : generateMines(size, mineCount, options.seed ?? 0x4d494e45);
  const initialPlayer: Player = {
    x: options.player?.x ?? Math.floor(size.width / 2),
    z: options.player?.z ?? Math.floor(size.depth / 2),
    footY: size.layers,
    facing: options.player?.facing ?? "north",
  };
  const setup: GameSetup = { size, mines, initialPlayer };
  validateSetup(setup);
  return buildInitialState(setup);
}

export function restartGame(state: GameState): GameState {
  return buildInitialState(state.setup);
}

export function getTargetCoordinate(state: GameState, kind: TargetKind): Coord {
  const vector = DIRECTION_VECTOR[state.player.facing];
  if (kind === "down") {
    return { x: state.player.x, y: state.player.footY - 1, z: state.player.z };
  }
  if (kind === "front") {
    return {
      x: state.player.x + vector.x,
      y: state.player.footY,
      z: state.player.z + vector.z,
    };
  }
  const groundVector =
    kind === "frontDown"
      ? vector
      : kind === "backDown"
        ? { x: -vector.x, z: -vector.z }
        : kind === "rightDown"
          ? { x: -vector.z, z: vector.x }
          : { x: vector.z, z: -vector.x };
  return {
    x: state.player.x + groundVector.x,
    y: state.player.footY - 1,
    z: state.player.z + groundVector.z,
  };
}

/** Only these returned solid cells may be clicked, dug, or flagged by the UI. */
export function getDigTargets(state: GameState): readonly DigTarget[] {
  if (state.status !== "playing") return [];
  const targets: DigTarget[] = [];
  for (const kind of TARGET_ORDER) {
    const coord = getTargetCoordinate(state, kind);
    const cell = getCell(state, coord);
    if (
      SURROUNDING_GROUND_TARGETS.includes(kind) &&
      getCell(state, { x: coord.x, y: coord.y + 1, z: coord.z })?.solid
    ) {
      continue;
    }
    if (cell?.solid) targets.push({ kind, coord, cell });
  }
  return targets;
}

function refreshActiveTarget(state: GameState, preferred = state.activeTarget): GameState {
  const targets = getDigTargets(state);
  const activeTarget = targets.some((target) => target.kind === preferred)
    ? preferred
    : (targets[0]?.kind ?? null);
  return activeTarget === state.activeTarget ? state : { ...state, activeTarget };
}

function resolveTarget(state: GameState, requested?: TargetKind | Coord): DigTarget | null {
  const targets = getDigTargets(state);
  if (requested === undefined) {
    return targets.find((target) => target.kind === state.activeTarget) ?? null;
  }
  if (typeof requested === "string") {
    return targets.find((target) => target.kind === requested) ?? null;
  }
  return targets.find((target) => sameCoord(target.coord, requested)) ?? null;
}

export function selectTarget(state: GameState, requested: TargetKind | Coord): GameState {
  const target = resolveTarget(state, requested);
  return target && target.kind !== state.activeTarget ? { ...state, activeTarget: target.kind } : state;
}

export function cycleTarget(state: GameState, step: 1 | -1 = 1): GameState {
  const targets = getDigTargets(state);
  if (targets.length < 2) return refreshActiveTarget(state);
  const current = targets.findIndex((target) => target.kind === state.activeTarget);
  const next = (Math.max(current, 0) + step + targets.length) % targets.length;
  return { ...state, activeTarget: targets[next].kind };
}

function replaceCell(state: GameState, cell: Cell): readonly Cell[] {
  const cells = state.cells.slice();
  cells[cellIndex(state.size, cell)] = cell;
  return cells;
}

function settlePlayer(state: GameState): GameState {
  if (state.player.footY === 0) return state;
  const support = getCell(state, {
    x: state.player.x,
    y: state.player.footY - 1,
    z: state.player.z,
  });
  if (support?.solid) return state;
  for (let y = state.player.footY - 2; y >= 0; y -= 1) {
    if (getCell(state, { x: state.player.x, y, z: state.player.z })?.solid) {
      return { ...state, player: { ...state.player, footY: y + 1 } };
    }
  }
  return { ...state, player: { ...state.player, footY: 0 } };
}

function removeFloodRegion(state: GameState, origin: Coord): readonly Cell[] {
  const cells = state.cells.slice();
  const queue: Coord[] = [origin];
  const expanded = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentKey = `${current.x},${current.y},${current.z}`;
    if (expanded.has(currentKey)) continue;
    expanded.add(currentKey);

    const currentIndex = cellIndex(state.size, current);
    const currentCell = cells[currentIndex];
    if (!currentCell?.solid || currentCell.flagged || currentCell.mine) continue;
    cells[currentIndex] = { ...currentCell, solid: false, flagged: false };

    if (countAdjacentMines(state, current) !== 0) continue;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dz === 0) continue;
        const neighbour = { x: current.x + dx, y: current.y, z: current.z + dz };
        if (!isInBounds(state.size, neighbour)) continue;
        const neighbourCell = cells[cellIndex(state.size, neighbour)];
        if (!neighbourCell.solid || neighbourCell.flagged || neighbourCell.mine) continue;

        // Numbered boundary cells are removed too, but only zero cells expand.
        if (countAdjacentMines(state, neighbour) === 0) queue.push(neighbour);
        else cells[cellIndex(state.size, neighbour)] = {
          ...neighbourCell,
          solid: false,
          flagged: false,
        };
      }
    }
  }

  return cells;
}

export function dig(state: GameState, requested?: TargetKind | Coord): GameState {
  const target = resolveTarget(state, requested);
  if (!target || target.cell.flagged) return state;
  const removed: Cell = { ...target.cell, solid: false, flagged: false };
  const cells = removed.mine
    ? replaceCell(state, removed)
    : removeFloodRegion(state, target.coord);
  let next: GameState = {
    ...state,
    cells,
    exploded: removed.mine ? target.coord : null,
    status: removed.mine ? "lost" : state.status,
  };
  next = settlePlayer(next);
  if (next.status === "playing" && next.cells.every((cell) => cell.mine || !cell.solid)) {
    next = { ...next, status: "won" };
  }
  return refreshActiveTarget(next);
}

export function toggleFlag(state: GameState, requested?: TargetKind | Coord): GameState {
  const target = resolveTarget(state, requested);
  if (!target) return state;
  const flagged = { ...target.cell, flagged: !target.cell.flagged };
  let next: GameState = { ...state, cells: replaceCell(state, flagged) };
  const remainingLayerMines = next.cells.filter(
    (cell) => cell.y === target.coord.y && cell.solid && cell.mine,
  );
  const hasIncorrectFlag = next.cells.some(
    (cell) => cell.y === target.coord.y && cell.solid && cell.flagged && !cell.mine,
  );
  if (
    remainingLayerMines.length > 0 &&
    !hasIncorrectFlag &&
    remainingLayerMines.every((cell) => cell.flagged)
  ) {
    next = {
      ...next,
      cells: next.cells.map((cell) =>
        cell.y === target.coord.y && cell.solid && cell.mine
          ? { ...cell, solid: false, flagged: false }
          : cell,
      ),
    };
    next = settlePlayer(next);
  }
  return refreshActiveTarget(next);
}

function columnFootY(state: GameState, x: number, z: number): number {
  for (let y = state.size.layers - 1; y >= 0; y -= 1) {
    if (getCell(state, { x, y, z })?.solid) return y + 1;
  }
  return 0;
}

/** World-fixed input: north is always -Z, regardless of camera rotation. */
export function movePlayer(state: GameState, direction: Direction): GameState {
  if (state.status !== "playing") return state;
  const vector = DIRECTION_VECTOR[direction];
  const x = state.player.x + vector.x;
  const z = state.player.z + vector.z;
  let player: Player = { ...state.player, facing: direction };
  if (x >= 0 && x < state.size.width && z >= 0 && z < state.size.depth) {
    const destinationFootY = columnFootY(state, x, z);
    // Any descent is legal; ascent is limited to one block.
    if (destinationFootY - state.player.footY <= 1) {
      player = { x, z, footY: destinationFootY, facing: direction };
    }
  }
  return refreshActiveTarget({ ...state, player }, "frontDown");
}

/** Counts mines in the 8 horizontal neighbours; vertical layers never contribute. */
export function countAdjacentMines(state: GameState, coord: Coord): number {
  let count = 0;
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dz === 0) continue;
      const neighbour = getCell(state, { x: coord.x + dx, y: coord.y, z: coord.z + dz });
      if (neighbour?.mine && neighbour.solid) count += 1;
    }
  }
  return count;
}

/**
 * Returns only the clue revealed by the dug safe cell directly above the
 * currently exposed surface. Intact cells and mines never expose clues.
 */
export function getVisibleClue(state: GameState, x: number, z: number): VisibleClue | null {
  if (x < 0 || x >= state.size.width || z < 0 || z >= state.size.depth) return null;
  const surfaceY = columnFootY(state, x, z);
  if (surfaceY >= state.size.layers) return null;
  const coord = { x, y: surfaceY, z };
  const revealed = getCell(state, coord);
  if (!revealed || revealed.solid || revealed.mine) return null;
  return { coord, surfaceY, count: countAdjacentMines(state, coord) };
}

export function remainingSafeBlocks(state: GameState): number {
  return state.cells.filter((cell) => cell.solid && !cell.mine).length;
}

export function directionFromKey(key: string): Direction | null {
  switch (key.toLowerCase()) {
    case "w":
    case "arrowup":
      return "north";
    case "d":
    case "arrowright":
      return "east";
    case "s":
    case "arrowdown":
      return "south";
    case "a":
    case "arrowleft":
      return "west";
    default:
      return null;
  }
}

export function reduceGame(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "move":
      return movePlayer(state, action.direction);
    case "selectTarget":
      return selectTarget(state, action.target);
    case "cycleTarget":
      return cycleTarget(state, action.step);
    case "dig":
      return dig(state, action.target);
    case "flag":
      return toggleFlag(state, action.target);
    case "restart":
      return restartGame(state);
  }
}
