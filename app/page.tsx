"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ThreeBoard from "./game/ThreeBoard";
import {
  createGame,
  dig,
  getDigTargets,
  getVisibleClues,
  movePlayerRelative,
  remainingMineBlocks,
  remainingSafeBlocks,
  selectTarget,
  toggleFlag,
  turnPlayer,
  type Coord,
  type Difficulty,
  type GameState,
  type StageLayout,
} from "./game/logic";
import type { ThreeBoardCameraMode } from "./game/ThreeBoard";

const cellId = ({ x, y, z }: Coord) => `${x},${y},${z}`;
const createSessionSeed = () => (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
const idToCoord = (id: string): Coord | null => {
  const values = id.split(",").map(Number);
  return values.length === 3 && values.every(Number.isInteger)
    ? { x: values[0], y: values[1], z: values[2] }
    : null;
};

export default function Home() {
  const [game, setGame] = useState<GameState>(() => createGame({ seed: 0x44454550 }));
  const [cameraMode, setCameraMode] = useState<ThreeBoardCameraMode>("oblique");
  const [boardSession, setBoardSession] = useState(0);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [stageLayout, setStageLayout] = useState<StageLayout>("stacked");
  const [visibleClueLayers, setVisibleClueLayers] = useState<ReadonlySet<number>>(
    () => new Set([0, 1, 2]),
  );

  const targets = useMemo(() => getDigTargets(game), [game]);
  const targetIds = useMemo(() => targets.map((target) => cellId(target.coord)), [targets]);
  const activeTargetId =
    targets.find((target) => target.kind === game.activeTarget)?.coord ?? null;

  const solidCells = useMemo(
    () =>
      game.cells
        .filter((cell) => cell.solid)
        .map((cell) => ({
          id: cellId(cell),
          x: cell.x,
          y: cell.y + 0.5,
          z: cell.z,
          layer: cell.y,
          mine: cell.mine,
        })),
    [game.cells],
  );
  const flaggedCells = useMemo(
    () =>
      game.cells
        .filter((cell) => cell.solid && cell.flagged)
        .map((cell) => ({
          id: cellId(cell),
          x: cell.x,
          y: cell.y + 0.5,
          z: cell.z,
          layer: cell.y,
        })),
    [game.cells],
  );
  const numberSurfaces = useMemo(() => {
    const surfaces = [];
    for (let z = 0; z < game.size.depth; z += 1) {
      for (let x = 0; x < game.size.width; x += 1) {
        for (const clue of getVisibleClues(game, x, z)) {
          if (clue.count <= 0) continue;
          surfaces.push({
            id: `clue-${x}-${z}-${clue.surfaceY}`,
            x,
            y: clue.surfaceY,
            z,
            value: clue.count,
            layer: clue.coord.y,
          });
        }
      }
    }
    return surfaces;
  }, [game]);
  const visibleNumberSurfaces = useMemo(
    () => numberSurfaces.filter((surface) => visibleClueLayers.has(surface.layer)),
    [numberSurfaces, visibleClueLayers],
  );

  const toggleClueLayer = useCallback((layer: number) => {
    setVisibleClueLayers((current) => {
      const next = new Set(current);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  }, []);

  const startNewField = useCallback(() => {
    setGame(createGame({ seed: createSessionSeed(), difficulty, layout: stageLayout }));
    setCameraMode("oblique");
    setVisibleClueLayers(new Set([0, 1, 2]));
    // Remounting clears every Three.js mesh, particle, hover and camera value
    // from the previous run before the selected stage is rebuilt from scratch.
    setBoardSession((current) => current + 1);
  }, [difficulty, stageLayout]);

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
      const key = event.key.toLowerCase();
      if (key === "w" || key === "arrowup") {
        event.preventDefault();
        setGame((current) => movePlayerRelative(current, 1));
        return;
      }
      if (key === "s" || key === "arrowdown") {
        event.preventDefault();
        setGame((current) => movePlayerRelative(current, -1));
        return;
      }
      if (key === "a" || key === "arrowleft") {
        event.preventDefault();
        setGame((current) => turnPlayer(current, -1));
        return;
      }
      if (key === "d" || key === "arrowright") {
        event.preventDefault();
        setGame((current) => turnPlayer(current, 1));
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

  const mineCount = remainingMineBlocks(game);
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
        <button className="new-field" type="button" onClick={startNewField}>
          NEW FIELD
        </button>
      </header>

      <section className="game-layout">
        <div className="board-wrap">
          <ThreeBoard
            key={boardSession}
            solidCells={solidCells}
            flaggedCells={flaggedCells}
            numberSurfaces={visibleNumberSurfaces}
            player={game.player}
            cameraMode={cameraMode}
            onCameraModeChange={setCameraMode}
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
              <button type="button" onClick={startNewField}>TRY AGAIN</button>
            </div>
          )}
        </div>

        <aside className="instructions">
          <div className="status"><i className={game.status} /> {statusText}</div>
          <div className="target-readout">
            <span>ACTIVE TARGET</span>
            <b>{game.activeTarget?.toUpperCase() ?? "NONE"}</b>
          </div>
          <div className="stage-setup" aria-label="Next field setup">
            <strong>NEXT FIELD</strong>
            <span className="setup-label">DIFFICULTY</span>
            <div className="setup-buttons" role="group" aria-label="Difficulty">
              {(["easy", "normal", "hard"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`setup-toggle difficulty-${option}`}
                  aria-label={`${option} difficulty`}
                  aria-pressed={difficulty === option}
                  onClick={() => setDifficulty(option)}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  {option.toUpperCase()}
                </button>
              ))}
            </div>
            <span className="setup-label">LAYOUT</span>
            <div className="setup-buttons layout-buttons" role="group" aria-label="Stage layout">
              {(
                [
                  ["stacked", "STACKED"],
                  ["pyramid", "PYRAMID"],
                ] as const
              ).map(([option, label]) => (
                <button
                  key={option}
                  type="button"
                  className="setup-toggle"
                  aria-label={`${label.toLowerCase()} stage`}
                  aria-pressed={stageLayout === option}
                  onClick={() => setStageLayout(option)}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  {label}
                </button>
              ))}
            </div>
            <small>
              Current: {game.setup.difficulty.toUpperCase()} / {game.setup.layout.toUpperCase()}
            </small>
          </div>
          <h2>COMMANDS</h2>
          <p><kbd>W / ↑</kbd> Advance · <kbd>S / ↓</kbd> Retreat<br /><kbd>A D / ← →</kbd> Turn 90°</p>
          <p><kbd>SPACE</kbd> / <kbd>LEFT CLICK</kbd><br />Excavate the active highlighted block</p>
          <p><kbd>SHIFT</kbd> / <kbd>RIGHT CLICK</kbd><br />Toggle a flag on a highlighted block</p>
          <div className="legend">
            <span><i className="swatch valid" /> Valid target</span>
            <span><i className="swatch active" /> Active target</span>
          </div>
          <div className="layer-visibility" role="group" aria-label="Clue layer visibility">
            <strong>CLUE LAYERS</strong>
            <div className="layer-buttons">
              {[2, 1, 0].map((layer) => {
                const visible = visibleClueLayers.has(layer);
                return (
                  <button
                    key={layer}
                    type="button"
                    className={`layer-toggle layer-${layer + 1}`}
                    aria-pressed={visible}
                    onClick={() => toggleClueLayer(layer)}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <i className={`swatch layer-${layer + 1}`} />
                    Layer {layer + 1}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="rule">
            <strong>FIELD RULE</strong><br />Climb one level at most. Descend or fall any distance. Mines are generated on the first excavation of each layer, and that first block is always safe. Same-height blocks can be selected in all four directions. A diagonal upper block can be excavated from any of four directions only when the space below it is open. Mine blocks carry a warning mark on their underside. Correctly flag every mine on a floor to purge that floor.
          </div>
        </aside>
      </section>
    </main>
  );
}
