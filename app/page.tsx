"use client";

export const dynamic = "force-static";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [stageLayout, setStageLayout] = useState<StageLayout>("stacked");
  const [touchAction, setTouchAction] = useState<"dig" | "flag">("dig");
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
    setMenuOpen(false);
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
      </header>

      <section className="game-layout">
        <div className="board-wrap">
          <ThreeBoard
            key={boardSession}
            solidCells={solidCells}
            flaggedCells={flaggedCells}
            revealMineLocations={game.status === "lost"}
            numberSurfaces={visibleNumberSurfaces}
            player={game.player}
            cameraMode={cameraMode}
            onCameraModeChange={setCameraMode}
            visibleClueLayers={visibleClueLayers}
            onToggleClueLayer={toggleClueLayer}
            validTargetIds={targetIds}
            activeTargetId={activeTargetId ? cellId(activeTargetId) : null}
            touchAction={touchAction}
            onDig={(id) => actOnId(id, "dig")}
            onFlag={(id) => actOnId(id, "flag")}
            onHover={handleHover}
            className="three-board"
          />
          <div className="mobile-controls" aria-label="Touch controls">
            <div className="mobile-movement" role="group" aria-label="Player movement">
              <button type="button" aria-label="Turn left" onClick={() => setGame((current) => turnPlayer(current, -1))}>↶</button>
              <button type="button" aria-label="Move forward" onClick={() => setGame((current) => movePlayerRelative(current, 1))}>↑</button>
              <button type="button" aria-label="Turn right" onClick={() => setGame((current) => turnPlayer(current, 1))}>↷</button>
              <button type="button" aria-label="Move backward" onClick={() => setGame((current) => movePlayerRelative(current, -1))}>↓</button>
            </div>
            <div className="mobile-actions" role="group" aria-label="Block action">
              <button
                type="button"
                className={touchAction === "dig" ? "selected" : undefined}
                aria-pressed={touchAction === "dig"}
                onClick={() => setTouchAction("dig")}
              >
                DIG
              </button>
              <button
                type="button"
                className={touchAction === "flag" ? "selected flag" : "flag"}
                aria-pressed={touchAction === "flag"}
                onClick={() => setTouchAction("flag")}
              >
                FLAG
              </button>
            </div>
          </div>
          {game.status !== "playing" && (
            <div className={`game-result ${game.status}`} role="status">
              <strong>{game.status === "won" ? "FIELD CLEARED" : "MISSION FAILED"}</strong>
              <button type="button" onClick={startNewField}>TRY AGAIN</button>
            </div>
          )}
          <details
            className="game-menu"
            open={menuOpen}
            onToggle={(event) => setMenuOpen(event.currentTarget.open)}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <summary aria-label="Open game menu">MENU</summary>
            <div className="game-menu-panel">
              <div className="stage-setup" aria-label="Next field setup">
                <strong>NEW FIELD</strong>
                <span className="setup-label">DIFFICULTY</span>
                <div className="setup-buttons" role="group" aria-label="Difficulty">
                  {(["easy", "normal", "hard", "veryHard"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`setup-toggle difficulty-${option}`}
                      aria-label={`${option === "veryHard" ? "very hard" : option} difficulty`}
                      aria-pressed={difficulty === option}
                      onClick={() => setDifficulty(option)}
                    >
                      {option === "veryHard" ? "VERY HARD" : option.toUpperCase()}
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
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <small>
                  Current: {game.setup.difficulty.toUpperCase()} / {game.setup.layout.toUpperCase()}
                </small>
                <button className="new-field menu-new-field" type="button" onClick={startNewField}>
                  START NEW FIELD
                </button>
              </div>
              <div className="command-reference">
                <strong>COMMANDS</strong>
                <p><kbd>W / ↑</kbd> Advance · <kbd>S / ↓</kbd> Retreat<br /><kbd>A D / ← →</kbd> Turn 90°</p>
                <p><kbd>SPACE</kbd> / <kbd>LEFT CLICK</kbd><br />Excavate the highlighted block</p>
                <p><kbd>SHIFT</kbd> / <kbd>RIGHT CLICK</kbd><br />Toggle a flag</p>
                <div className="legend">
                  <span><i className="swatch valid" /> Valid target</span>
                  <span><i className="swatch active" /> Active target</span>
                </div>
              </div>
            </div>
          </details>
        </div>
      </section>
    </main>
  );
}
