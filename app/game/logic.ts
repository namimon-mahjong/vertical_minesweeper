/** Framework-independent rules for the layered minesweeper board. */

export const DEFAULT_BOARD_SIZE = { width: 7, depth: 7, layers: 3 } as const;

export type Direction = "north" | "east" | "south" | "west";
export type Difficulty = "easy" | "normal" | "hard";
export type StageLayout = "stacked" | "pyramid";
export type TargetKind =
  | "front"
  | "right"
  | "back"
  | "left"
  | "down"
  | "frontDown"
  | "rightDown"
  | "backDown"
  | "leftDown"
  | "frontUp"
  | "rightUp"
  | "backUp"
  | "leftUp";
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
  /** False for coordinates outside shaped layouts such as the pyramid. */
  readonly playable: boolean;
  readonly mine: boolean;
  readonly solid: boolean;
  readonly flagged: boolean;
}

export interface GameSetup {
  readonly size: BoardSize;
  readonly difficulty: Difficulty;
  readonly layout: StageLayout;
  /** Fixed fixtures are stored here; procedural fields keep this empty. */
  readonly mines: readonly Coord[];
  readonly mineCountsByLayer: readonly number[];
  readonly seed: number;
  readonly lazyMines: boolean;
  readonly initialPlayer: Player;
}

export interface GameState {
  readonly size: BoardSize;
  readonly cells: readonly Cell[];
  readonly player: Player;
  readonly activeTarget: TargetKind | null;
  readonly status: GameStatus;
  readonly exploded: Coord | null;
  /** Procedural mines are generated independently on the first dig of each layer. */
  readonly generatedLayers: readonly boolean[];
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
  readonly difficulty?: Difficulty;
  readonly layout?: StageLayout;
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

const SURROUNDING_UPPER_TARGETS: readonly TargetKind[] = [
  "frontUp",
  "rightUp",
  "backUp",
  "leftUp",
];

const SURROUNDING_LEVEL_TARGETS: readonly TargetKind[] = ["front", "right", "back", "left"];

const TARGET_ORDER: readonly TargetKind[] = [
  ...SURROUNDING_GROUND_TARGETS,
  ...SURROUNDING_UPPER_TARGETS,
  ...SURROUNDING_LEVEL_TARGETS,
  "down",
];

const DIRECTION_VECTOR: Readonly<Record<Direction, Readonly<{ x: number; z: number }>>> = {
  north: { x: 0, z: -1 },
  east: { x: 1, z: 0 },
  south: { x: 0, z: 1 },
  west: { x: -1, z: 0 },
};

const PYRAMID_MINE_DENSITY: Readonly<Record<Difficulty, number>> = {
  easy: 0.08,
  normal: 0.12,
  hard: 0.18,
};

const STACKED_MINE_DENSITY: Readonly<Record<Difficulty, number>> = {
  easy: 0.1,
  normal: 0.15,
  hard: 0.2,
};

const STACKED_SIDE: Readonly<Record<Difficulty, number>> = {
  easy: 7,
  normal: 9,
  hard: 11,
};

const PYRAMID_TOP_SIDE: Readonly<Record<Difficulty, number>> = {
  easy: 3,
  normal: 5,
  hard: 7,
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

export function isPlayableCoord(size: BoardSize, layout: StageLayout, coord: Coord): boolean {
  if (!isInBounds(size, coord)) return false;
  if (layout === "stacked") return true;
  // Layer zero is the bottom: each higher floor steps inward by one block.
  const margin = coord.y;
  return (
    coord.x >= margin &&
    coord.x < size.width - margin &&
    coord.z >= margin &&
    coord.z < size.depth - margin
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

function playableCoords(size: BoardSize, layout: StageLayout): Coord[] {
  const coords: Coord[] = [];
  for (let y = 0; y < size.layers; y += 1) {
    for (let z = 0; z < size.depth; z += 1) {
      for (let x = 0; x < size.width; x += 1) {
        const coord = { x, y, z };
        if (isPlayableCoord(size, layout, coord)) coords.push(coord);
      }
    }
  }
  return coords;
}

function generateLayerMines(
  size: BoardSize,
  layout: StageLayout,
  layer: number,
  requestedCount: number,
  seed: number,
  excluded: Coord,
): Coord[] {
  const coords = playableCoords(size, layout).filter(
    (coord) => coord.y === layer && !sameCoord(coord, excluded),
  );
  const random = seededRandom((seed ^ Math.imul(layer + 1, 0x9e3779b9)) >>> 0);
  for (let index = coords.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [coords[index], coords[swapIndex]] = [coords[swapIndex], coords[index]];
  }
  return coords.slice(0, Math.max(0, Math.min(requestedCount, coords.length)));
}

function playableCountsByLayer(size: BoardSize, layout: StageLayout): number[] {
  const counts = Array.from({ length: size.layers }, () => 0);
  for (const coord of playableCoords(size, layout)) counts[coord.y] += 1;
  return counts;
}

function allocateRequestedMines(playableCounts: readonly number[], requestedCount: number): number[] {
  const capacities = playableCounts.map((count) => Math.max(0, count - 1));
  const totalPlayable = playableCounts.reduce((sum, count) => sum + count, 0);
  const maximum = capacities.reduce((sum, count) => sum + count, 0);
  const requested = Math.max(0, Math.min(Math.floor(requestedCount), maximum));
  if (requested === 0 || totalPlayable === 0) return capacities.map(() => 0);

  const raw = playableCounts.map((count) => (requested * count) / totalPlayable);
  const allocated = raw.map((value, layer) => Math.min(Math.floor(value), capacities[layer]));
  let remaining = requested - allocated.reduce((sum, count) => sum + count, 0);
  const priority = raw
    .map((value, layer) => ({ layer, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);
  while (remaining > 0) {
    let changed = false;
    for (const { layer } of priority) {
      if (remaining === 0) break;
      if (allocated[layer] >= capacities[layer]) continue;
      allocated[layer] += 1;
      remaining -= 1;
      changed = true;
    }
    if (!changed) break;
  }
  return allocated;
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
    setup.initialPlayer.footY !== setup.size.layers ||
    !isPlayableCoord(setup.size, setup.layout, {
      x: setup.initialPlayer.x,
      y: setup.size.layers - 1,
      z: setup.initialPlayer.z,
    })
  ) {
    throw new RangeError("The initial player must stand on a playable top-layer block");
  }
  const seen = new Set<string>();
  for (const mine of setup.mines) {
    if (!isPlayableCoord(setup.size, setup.layout, mine)) {
      throw new RangeError("Mine coordinate is outside the playable stage");
    }
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
        const playable = isPlayableCoord(setup.size, setup.layout, { x, y, z });
        cells.push({
          x,
          y,
          z,
          playable,
          mine: playable && mineKeys.has(`${x},${y},${z}`),
          solid: playable,
          flagged: false,
        });
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
    generatedLayers: Array.from({ length: setup.size.layers }, () => !setup.lazyMines),
    setup,
  };
  return refreshActiveTarget(state);
}

export function createGame(options: CreateGameOptions = {}): GameState {
  const difficulty = options.difficulty ?? "normal";
  const layout = options.layout ?? "stacked";
  const layers = options.size?.layers ?? DEFAULT_BOARD_SIZE.layers;
  const pyramidSide = PYRAMID_TOP_SIDE[difficulty] + (layers - 1) * 2;
  const procedural = options.mines === undefined;
  const generatedSide = layout === "pyramid" ? pyramidSide : STACKED_SIDE[difficulty];
  const defaultSide = procedural ? generatedSide : DEFAULT_BOARD_SIZE.width;
  const size: BoardSize = {
    width: options.size?.width ?? defaultSide,
    depth: options.size?.depth ?? defaultSide,
    layers,
  };
  assertPositiveInteger(size.width, "width");
  assertPositiveInteger(size.depth, "depth");
  assertPositiveInteger(size.layers, "layers");
  const seed = options.seed ?? 0x4d494e45;
  const mines = options.mines?.map((mine) => ({ ...mine })) ?? [];
  const playableCounts = playableCountsByLayer(size, layout);
  const density =
    layout === "stacked"
      ? STACKED_MINE_DENSITY[difficulty]
      : PYRAMID_MINE_DENSITY[difficulty];
  const mineCountsByLayer = procedural
    ? options.mineCount === undefined
      ? playableCounts.map((count) => Math.min(Math.max(0, count - 1), Math.round(count * density)))
      : allocateRequestedMines(playableCounts, options.mineCount)
    : Array.from({ length: size.layers }, (_, layer) =>
        mines.filter((mine) => mine.y === layer).length,
      );
  const initialPlayer: Player = {
    x: options.player?.x ?? Math.floor(size.width / 2),
    z: options.player?.z ?? Math.floor(size.depth / 2),
    footY: size.layers,
    facing: options.player?.facing ?? "north",
  };
  const setup: GameSetup = {
    size,
    difficulty,
    layout,
    mines,
    mineCountsByLayer,
    seed,
    lazyMines: procedural,
    initialPlayer,
  };
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
  const relativeVector =
    kind === "front" || kind === "frontDown" || kind === "frontUp"
      ? vector
      : kind === "back" || kind === "backDown" || kind === "backUp"
        ? { x: -vector.x, z: -vector.z }
        : kind === "right" || kind === "rightDown" || kind === "rightUp"
          ? { x: -vector.z, z: vector.x }
          : { x: vector.z, z: -vector.x };
  const y =
    SURROUNDING_LEVEL_TARGETS.includes(kind)
      ? state.player.footY
      : SURROUNDING_UPPER_TARGETS.includes(kind)
        ? state.player.footY + 1
        : state.player.footY - 1;
  return {
    x: state.player.x + relativeVector.x,
    y,
    z: state.player.z + relativeVector.z,
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
    if (SURROUNDING_UPPER_TARGETS.includes(kind)) {
      const below = getCell(state, { x: coord.x, y: coord.y - 1, z: coord.z });
      if (!below || below.solid) continue;
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

function generateMinesForFirstDig(state: GameState, coord: Coord): GameState {
  // Treat pre-feature states retained by development hot reload as already generated.
  if (!state.generatedLayers || state.generatedLayers[coord.y]) return state;
  const mines = generateLayerMines(
    state.size,
    state.setup.layout,
    coord.y,
    state.setup.mineCountsByLayer[coord.y] ?? 0,
    state.setup.seed,
    coord,
  );
  const mineKeys = new Set(mines.map((mine) => `${mine.x},${mine.y},${mine.z}`));
  const generatedLayers = state.generatedLayers.slice();
  generatedLayers[coord.y] = true;
  return {
    ...state,
    cells: state.cells.map((cell) =>
      cell.y === coord.y
        ? { ...cell, mine: cell.playable && mineKeys.has(`${cell.x},${cell.y},${cell.z}`) }
        : cell,
    ),
    generatedLayers,
  };
}

export function dig(state: GameState, requested?: TargetKind | Coord): GameState {
  const target = resolveTarget(state, requested);
  if (!target || target.cell.flagged) return state;
  const generatedState = generateMinesForFirstDig(state, target.coord);
  const generatedCell = getCell(generatedState, target.coord);
  if (!generatedCell) return state;
  const removed: Cell = { ...generatedCell, solid: false, flagged: false };
  const cells = removed.mine
    ? replaceCell(generatedState, removed)
    : removeFloodRegion(generatedState, target.coord);
  let next: GameState = {
    ...generatedState,
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

function movePlayerInDirection(
  state: GameState,
  direction: Direction,
  facing: Direction,
): GameState {
  if (state.status !== "playing") return state;
  const vector = DIRECTION_VECTOR[direction];
  const x = state.player.x + vector.x;
  const z = state.player.z + vector.z;
  let player: Player = { ...state.player, facing };
  if (x >= 0 && x < state.size.width && z >= 0 && z < state.size.depth) {
    const destinationFootY = columnFootY(state, x, z);
    // Any descent is legal; ascent is limited to one block.
    if (destinationFootY - state.player.footY <= 1) {
      player = { x, z, footY: destinationFootY, facing };
    }
  }
  return refreshActiveTarget({ ...state, player }, "frontDown");
}

/** World-fixed input: north is always -Z, regardless of camera rotation. */
export function movePlayer(state: GameState, direction: Direction): GameState {
  return movePlayerInDirection(state, direction, direction);
}

const DIRECTION_ORDER: readonly Direction[] = ["north", "east", "south", "west"];

function rotatedDirection(direction: Direction, quarterTurns: number): Direction {
  const index = DIRECTION_ORDER.indexOf(direction);
  return DIRECTION_ORDER[(index + quarterTurns + DIRECTION_ORDER.length) % DIRECTION_ORDER.length];
}

/** First-person movement travels along the view direction without changing it. */
export function movePlayerRelative(state: GameState, step: 1 | -1): GameState {
  const direction = step === 1 ? state.player.facing : rotatedDirection(state.player.facing, 2);
  return movePlayerInDirection(state, direction, state.player.facing);
}

/** Rotates the player, and therefore the first-person camera, by exactly 90 degrees. */
export function turnPlayer(state: GameState, step: 1 | -1): GameState {
  if (state.status !== "playing") return state;
  const facing = rotatedDirection(state.player.facing, step);
  return refreshActiveTarget({ ...state, player: { ...state.player, facing } }, "frontDown");
}

/** Counts mines in the 8 horizontal neighbours; vertical layers never contribute. */
export function countAdjacentMines(state: GameState, coord: Coord): number {
  let count = 0;
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dz === 0) continue;
      const neighbour = getCell(state, { x: coord.x + dx, y: coord.y, z: coord.z + dz });
      if (neighbour?.mine) count += 1;
    }
  }
  return count;
}

/**
 * Returns only the clue revealed by the dug safe cell directly above the
 * currently exposed surface. Intact cells and mines never expose clues.
 */
export function getVisibleClue(state: GameState, x: number, z: number): VisibleClue | null {
  return getVisibleClues(state, x, z)[0] ?? null;
}

/** Every dug safe cell retains its clue at that layer's original surface height. */
export function getVisibleClues(state: GameState, x: number, z: number): readonly VisibleClue[] {
  if (x < 0 || x >= state.size.width || z < 0 || z >= state.size.depth) return [];
  const clues: VisibleClue[] = [];
  for (let y = state.size.layers - 1; y >= 0; y -= 1) {
    const coord = { x, y, z };
    const revealed = getCell(state, coord);
    if (!revealed || !revealed.playable || revealed.solid || revealed.mine) continue;
    clues.push({ coord, surfaceY: y, count: countAdjacentMines(state, coord) });
  }
  return clues;
}

export function remainingSafeBlocks(state: GameState): number {
  const generatedLayers =
    state.generatedLayers ?? Array.from({ length: state.size.layers }, () => true);
  return generatedLayers.reduce((total, generated, layer) => {
    const solidPlayable = state.cells.filter(
      (cell) => cell.y === layer && cell.playable && cell.solid,
    );
    return (
      total +
      (generated
        ? solidPlayable.filter((cell) => !cell.mine).length
        : Math.max(0, solidPlayable.length - (state.setup.mineCountsByLayer[layer] ?? 0)))
    );
  }, 0);
}

export function remainingMineBlocks(state: GameState): number {
  const generatedLayers =
    state.generatedLayers ?? Array.from({ length: state.size.layers }, () => true);
  return generatedLayers.reduce(
    (total, generated, layer) =>
      total +
      (generated
        ? state.cells.filter((cell) => cell.y === layer && cell.solid && cell.mine).length
        : (state.setup.mineCountsByLayer[layer] ?? 0)),
    0,
  );
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
