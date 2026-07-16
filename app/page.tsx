"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ThreeBoard from "./game/ThreeBoard";
import {
  createGame,
  dig,
  directionFromKey,
  getDigTargets,
  getVisibleClue,
  movePlayer,
  remainingSafeBlocks,
  restartGame,
  selectTarget,
  toggleFlag,
  type Coord,
  type GameState,
} from "./game/logic";

const cellId = ({ x, y, z }: Coord) => `${x},${y},${z}`;
const idToCoord = (id: string): Coord | null => {
  const values = id.split(",").map(Number);
  return values.length === 3 && values.every(Number.isInteger)
    ? { x: values[0], y: values[1], z: values[2] }
    : null;
};

export default function Home() {
  const [game, setGame] = useState<GameState>(() => createGame({ seed: 0x44454550 }));

  const targets = useMemo(() => getDigTargets(game), [game]);
  const targetIds = useMemo(() => targets.map((target) => cellId(target.coord)), [targets]);
  const activeTargetId =
    targets.find((target) => target.kind === game.activeTarget)?.coord ?? null;

  const solidCells = useMemo(
    () =>
      game.cells
        .filter((cell) => cell.solid)
        .map((cell) => ({ id: cellId(cell), x: cell.x, y: cell.y + 0.5, z: cell.z })),
    [game.cells],
  );
  const flaggedCells = useMemo(
    () =>
      game.cells
        .filter((cell) => cell.solid && cell.flagged)
        .map((cell) => ({ id: cellId(cell), x: cell.x, y: cell.y + 0.5, z: cell.z })),
    [game.cells],
  );
  const numberSurfaces = useMemo(() => {
    const surfaces = [];
    for (let z = 0; z < game.size.depth; z += 1) {
      for (let x = 0; x < game.size.width; x += 1) {
        const clue = getVisibleClue(game, x, z);
        if (clue && clue.count > 0) {
          surfaces.push({
            id: `clue-${x}-${z}-${clue.surfaceY}`,
            x,
            y: clue.surfaceY,
            z,
            value: clue.count,
          });
        }
      }
    }
    return surfaces;
  }, [game]);

  const actOnId = useCallback((id: string, action: "dig" | "flag") => {
    const coord = idToCoord(id);
    if (!coord) return;
    setGame((current) => (action === "dig" ? dig(current, coord) : toggleFlag(current, coord)));
  }, []);

  const handleHover = useCallback((id: string | null) => {
    if (!id) return;
    const coord = idToCoord(id);
    if (coord) setGame((current) => selectTarget(current, coord));
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const direction = directionFromKey(event.key);
      if (direction) {
        event.preventDefault();
        setGame((current) => movePlayer(current, direction));
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        if (!event.repeat) setGame((current) => dig(current));
      } else if (event.key === "Shift") {
        event.preventDefault();
        if (!event.repeat) setGame((current) => toggleFlag(current));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const mineCount = game.cells.filter((cell) => cell.mine && cell.solid).length;
  const flagCount = game.cells.filter((cell) => cell.flagged).length;
  const statusText =
    game.status === "lost" ? "MINE DETONATED" : game.status === "won" ? "FIELD CLEARED" : "SECTOR ACTIVE";

  return (
    <main className="app-shell">
      <header className="hud">
        <div className="brand">
          <p className="eyebrow">VERTICAL MINESWEEPER / 03 LAYERS</p>
          <h1>DEEP <span>FIELD</span></h1>
        </div>
        <div className="stat"><b>{mineCount}</b><small>MINES</small></div>
        <div className="stat"><b>{flagCount}</b><small>FLAGS</small></div>
        <div className="stat"><b>{remainingSafeBlocks(game)}</b><small>SAFE BLOCKS</small></div>
        <button className="new-field" type="button" onClick={() => setGame((current) => restartGame(current))}>
          NEW FIELD
        </button>
      </header>

      <section className="game-layout">
        <div className="board-wrap">
          <ThreeBoard
            solidCells={solidCells}
            flaggedCells={flaggedCells}
            numberSurfaces={numberSurfaces}
            player={game.player}
            validTargetIds={targetIds}
            activeTargetId={activeTargetId ? cellId(activeTargetId) : null}
            onDig={(id) => actOnId(id, "dig")}
            onFlag={(id) => actOnId(id, "flag")}
            onHover={handleHover}
            className="three-board"
          />
          {game.status !== "playing" && (
            <div className={`game-result ${game.status}`} role="status">
              <strong>{game.status === "won" ? "FIELD CLEARED" : "MISSION FAILED"}</strong>
              <button type="button" onClick={() => setGame((current) => restartGame(current))}>TRY AGAIN</button>
            </div>
          )}
        </div>

        <aside className="instructions">
          <div className="status"><i className={game.status} /> {statusText}</div>
          <div className="target-readout">
            <span>ACTIVE TARGET</span>
            <b>{game.activeTarget?.toUpperCase() ?? "NONE"}</b>
          </div>
          <h2>COMMANDS</h2>
          <p><kbd>W A S D</kbd> / <kbd>ARROWS</kbd><br />Move and face a world direction</p>
          <p><kbd>SPACE</kbd> / <kbd>LEFT CLICK</kbd><br />Excavate the active highlighted block</p>
          <p><kbd>SHIFT</kbd> / <kbd>RIGHT CLICK</kbd><br />Toggle a flag on a highlighted block</p>
          <div className="legend">
            <span><i className="swatch valid" /> Valid target</span>
            <span><i className="swatch active" /> Active target</span>
          </div>
          <div className="rule">
            <strong>FIELD RULE</strong><br />Climb one level at most. Descend or fall any distance. All four surrounding ground blocks, the front wall and the block below can be touched. Correctly flag every mine on a floor to purge that floor.
          </div>
        </aside>
      </section>
    </main>
  );
}
