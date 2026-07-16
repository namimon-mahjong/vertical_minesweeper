import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's type-strip test runner intentionally imports the .ts source directly.
import * as gameLogic from "../app/game/logic.ts";

const {
  countAdjacentMines,
  createGame,
  dig,
  getCell,
  getDigTargets,
  getVisibleClue,
  getVisibleClues,
  movePlayer,
  movePlayerRelative,
  remainingMineBlocks,
  remainingSafeBlocks,
  restartGame,
  toggleFlag,
  turnPlayer,
} = gameLogic;

type GameState = gameLogic.GameState;

test("default board is a full 7x7x3 cube with the player on top", () => {
  const state = createGame({ mines: [] });
  assert.deepEqual(state.size, { width: 7, depth: 7, layers: 3 });
  assert.equal(state.cells.length, 147);
  assert.ok(state.cells.every((cell) => cell.solid));
  assert.ok(state.cells.every((cell) => cell.playable));
  assert.equal(state.player.footY, 3);
  assert.equal(state.activeTarget, "frontDown");
});

test("stacked difficulty increases both board size and mine density", () => {
  const expected = {
    easy: { side: 7, mines: 15 },
    normal: { side: 9, mines: 36 },
    hard: { side: 11, mines: 72 },
  } as const;
  for (const [difficulty, fixture] of Object.entries(expected)) {
    const state = createGame({ difficulty: difficulty as keyof typeof expected, seed: 17 });
    assert.deepEqual(state.size, { width: fixture.side, depth: fixture.side, layers: 3 });
    assert.equal(state.cells.filter((cell) => cell.mine).length, 0);
    assert.equal(remainingMineBlocks(state), fixture.mines);
    assert.equal(remainingSafeBlocks(state), fixture.side * fixture.side * 3 - fixture.mines);
    assert.equal(state.setup.difficulty, difficulty);
  }
});

test("pyramid apex grows from 3x3 to 5x5 to 7x7 with difficulty", () => {
  const fixtures = [
    { difficulty: "easy", side: 7, cellsByLayer: [49, 25, 9], total: 83 },
    { difficulty: "normal", side: 9, cellsByLayer: [81, 49, 25], total: 155 },
    { difficulty: "hard", side: 11, cellsByLayer: [121, 81, 49], total: 251 },
  ] as const;

  for (const fixture of fixtures) {
    const state = createGame({
      layout: "pyramid",
      difficulty: fixture.difficulty,
      mineCount: 0,
    });
    assert.deepEqual(state.size, { width: fixture.side, depth: fixture.side, layers: 3 });
    assert.deepEqual(
      [0, 1, 2].map(
        (layer) => state.cells.filter((cell) => cell.y === layer && cell.playable).length,
      ),
      fixture.cellsByLayer,
    );
    assert.equal(remainingSafeBlocks(state), fixture.total);
    assert.deepEqual(state.player, {
      x: Math.floor(fixture.side / 2),
      z: Math.floor(fixture.side / 2),
      footY: 3,
      facing: "north",
    });
  }
});

test("pyramid mines are generated only inside its playable footprint", () => {
  const expectedMines = {
    easy: { total: 7, top: 1 },
    normal: { total: 19, top: 3 },
    hard: { total: 46, top: 9 },
  } as const;
  for (const [difficulty, fixture] of Object.entries(expectedMines)) {
    const state = createGame({
      layout: "pyramid",
      difficulty: difficulty as keyof typeof expectedMines,
      seed: 23,
    });
    assert.equal(state.cells.filter((cell) => cell.mine).length, 0);
    assert.equal(remainingMineBlocks(state), fixture.total);
    const firstDig = dig(state, "down");
    assert.equal(firstDig.status, "playing");
    assert.deepEqual(firstDig.generatedLayers, [false, false, true]);
    assert.equal(firstDig.cells.filter((cell) => cell.y === 2 && cell.mine).length, fixture.top);
    assert.equal(
      getCell(firstDig, {
        x: Math.floor(state.size.width / 2),
        y: 2,
        z: Math.floor(state.size.depth / 2),
      })?.mine,
      false,
    );
    assert.ok(firstDig.cells.filter((cell) => cell.mine).every((cell) => cell.playable));
  }
  assert.throws(
    () =>
      createGame({
        layout: "pyramid",
        difficulty: "hard",
        mines: [{ x: 0, y: 2, z: 0 }],
      }),
    /outside the playable stage/,
  );
});

test("the first dig on every procedural layer is safe", () => {
  const state = createGame({
    size: { width: 3, depth: 3, layers: 2 },
    difficulty: "hard",
    layout: "stacked",
    seed: 31,
  });
  assert.deepEqual(state.generatedLayers, [false, false]);
  assert.equal(state.cells.filter((cell) => cell.mine).length, 0);
  assert.equal(remainingMineBlocks(state), 4);

  const topDig = dig(state, "down");
  assert.equal(topDig.status, "playing");
  assert.deepEqual(topDig.generatedLayers, [false, true]);
  assert.equal(getCell(topDig, { x: 1, y: 1, z: 1 })?.mine, false);
  assert.equal(topDig.cells.filter((cell) => cell.y === 1 && cell.mine).length, 2);
  assert.equal(topDig.player.footY, 1);

  const bottomDig = dig(topDig, "down");
  assert.equal(bottomDig.status, "playing");
  assert.deepEqual(bottomDig.generatedLayers, [true, true]);
  assert.equal(getCell(bottomDig, { x: 1, y: 0, z: 1 })?.mine, false);
  assert.equal(bottomDig.cells.filter((cell) => cell.y === 0 && cell.mine).length, 2);
  assert.equal(bottomDig.player.footY, 0);
});

test("the four surrounding ground blocks and down can be acted upon", () => {
  const state = createGame({ mines: [] });
  const arbitrary = { x: 0, y: 0, z: 0 };
  assert.strictEqual(dig(state, arbitrary), state);
  assert.strictEqual(toggleFlag(state, arbitrary), state);

  const targets = getDigTargets(state);
  assert.deepEqual(
    targets.map(({ kind, coord }) => ({ kind, coord })),
    [
      { kind: "frontDown", coord: { x: 3, y: 2, z: 2 } },
      { kind: "rightDown", coord: { x: 4, y: 2, z: 3 } },
      { kind: "backDown", coord: { x: 3, y: 2, z: 4 } },
      { kind: "leftDown", coord: { x: 2, y: 2, z: 3 } },
      { kind: "down", coord: { x: 3, y: 2, z: 3 } },
    ],
  );
  const dug = dig(state, "frontDown");
  assert.equal(getCell(dug, { x: 3, y: 2, z: 2 })?.solid, false);
});

test("all four same-height blocks can be selected, dug, and flagged", () => {
  const base = createGame({ mines: [] });
  const fixture: GameState = {
    ...base,
    cells: base.cells.map((cell) =>
      cell.x === 3 && cell.z === 3 && cell.y === 2 ? { ...cell, solid: false } : cell,
    ),
    player: { ...base.player, footY: 2 },
    activeTarget: "front",
  };
  const levelTargets = getDigTargets(fixture).filter(({ kind }) =>
    (["front", "right", "back", "left"] as const).includes(
      kind as "front" | "right" | "back" | "left",
    ),
  );

  assert.deepEqual(
    levelTargets.map(({ kind, coord }) => ({ kind, coord })),
    [
      { kind: "front", coord: { x: 3, y: 2, z: 2 } },
      { kind: "right", coord: { x: 4, y: 2, z: 3 } },
      { kind: "back", coord: { x: 3, y: 2, z: 4 } },
      { kind: "left", coord: { x: 2, y: 2, z: 3 } },
    ],
  );
  assert.equal(getCell(dig(fixture, "back"), { x: 3, y: 2, z: 4 })?.solid, false);
  assert.equal(getCell(toggleFlag(fixture, "left"), { x: 2, y: 2, z: 3 })?.flagged, true);
});

test("all four surrounding lower targets are blocked by a solid block above", () => {
  const base = createGame({ mines: [] });
  const cells = base.cells.map((cell) =>
    cell.x === 3 && cell.y === 2 && cell.z === 3 ? { ...cell, solid: false } : cell,
  );
  const lowered: GameState = {
    ...base,
    cells,
    player: { ...base.player, footY: 2 },
    activeTarget: "frontDown",
  };
  const surroundingKinds = ["frontDown", "rightDown", "backDown", "leftDown"] as const;
  for (const kind of ["front", "right", "back", "left"] as const) {
    assert.ok(getDigTargets(lowered).some((target) => target.kind === kind));
  }
  for (const kind of surroundingKinds) {
    assert.ok(!getDigTargets(lowered).some((target) => target.kind === kind));
    assert.strictEqual(dig(lowered, kind), lowered);
  }

  const withoutUpperBlocks: GameState = {
    ...lowered,
    cells: lowered.cells.map((cell) =>
      cell.y === 2 &&
      ((cell.x === 3 && (cell.z === 2 || cell.z === 4)) ||
        (cell.z === 3 && (cell.x === 2 || cell.x === 4)))
        ? { ...cell, solid: false }
        : cell,
    ),
  };
  for (const kind of surroundingKinds) {
    assert.ok(getDigTargets(withoutUpperBlocks).some((target) => target.kind === kind));
  }
});

test("all four diagonal upper targets require an open cell directly below", () => {
  const base = createGame({ mines: [] });
  const openCells = new Set([
    "3,1,3",
    "3,2,3",
    "3,1,2",
    "4,1,3",
    "3,1,4",
    "2,1,3",
  ]);
  const fixture: GameState = {
    ...base,
    cells: base.cells.map((cell) =>
      openCells.has(`${cell.x},${cell.y},${cell.z}`) ? { ...cell, solid: false } : cell,
    ),
    player: { ...base.player, footY: 1 },
    activeTarget: "frontUp",
  };
  const upperKinds = ["frontUp", "rightUp", "backUp", "leftUp"] as const;
  for (const kind of upperKinds) {
    assert.ok(getDigTargets(fixture).some((target) => target.kind === kind));
  }
  assert.equal(getCell(dig(fixture, "frontUp"), { x: 3, y: 2, z: 2 })?.solid, false);

  const blockedFront: GameState = {
    ...fixture,
    cells: fixture.cells.map((cell) =>
      cell.x === 3 && cell.y === 1 && cell.z === 2 ? { ...cell, solid: true } : cell,
    ),
  };
  assert.ok(!getDigTargets(blockedFront).some((target) => target.kind === "frontUp"));
  assert.ok(getDigTargets(blockedFront).some((target) => target.kind === "rightUp"));
});

test("a flag blocks digging until it is removed", () => {
  const state = createGame({ mines: [] });
  const flagged = toggleFlag(state, "frontDown");
  assert.equal(getCell(flagged, { x: 3, y: 2, z: 2 })?.flagged, true);
  assert.strictEqual(dig(flagged, "frontDown"), flagged);
  const unflagged = toggleFlag(flagged, "frontDown");
  assert.equal(getCell(dig(unflagged, "frontDown"), { x: 3, y: 2, z: 2 })?.solid, false);
});

test("digging support removes the block and makes the player fall", () => {
  const state = createGame({ mines: [] });
  const once = dig(state, "down");
  assert.equal(once.player.footY, 2);
  assert.equal(getCell(once, { x: 3, y: 2, z: 3 })?.solid, false);
  const twice = dig(once, "down");
  assert.equal(twice.player.footY, 1);
});

test("movement ignores blocks two cells above the path but blocks a directly overhead block", () => {
  const base = createGame({ mines: [] });
  const cells = base.cells.map((cell) =>
    cell.x === 3 && cell.z === 2 && cell.y >= 1 ? { ...cell, solid: false } : cell,
  );
  const fixture: GameState = { ...base, cells };
  const descended = movePlayer(fixture, "north");
  assert.deepEqual(descended.player, { x: 3, z: 2, footY: 1, facing: "north" });

  const withOnlyHighBlock: GameState = {
    ...descended,
    cells: descended.cells.map((cell) =>
      cell.x === 3 && cell.z === 3 && cell.y === 1 ? { ...cell, solid: false } : cell,
    ),
  };
  const passed = movePlayer(withOnlyHighBlock, "south");
  assert.deepEqual(passed.player, { x: 3, z: 3, footY: 1, facing: "south" });

  const blocked = movePlayer(descended, "south");
  assert.deepEqual(blocked.player, { x: 3, z: 2, footY: 1, facing: "south" });
});

test("relative controls advance, retreat, and turn in 90-degree steps", () => {
  const base = createGame({ mines: [] });
  const advanced = movePlayerRelative(base, 1);
  assert.deepEqual(advanced.player, { x: 3, z: 2, footY: 3, facing: "north" });
  const turned = turnPlayer(advanced, 1);
  assert.deepEqual(turned.player, { x: 3, z: 2, footY: 3, facing: "east" });
  const retreated = movePlayerRelative(turned, -1);
  assert.deepEqual(retreated.player, { x: 2, z: 2, footY: 3, facing: "east" });
  assert.equal(turnPlayer(turnPlayer(turned, -1), -1).player.facing, "west");
});

test("only a dug safe cell reveals its same-layer clue", () => {
  const state = createGame({
    mines: [
      { x: 2, y: 2, z: 2 },
      { x: 4, y: 2, z: 2 },
      { x: 3, y: 1, z: 2 },
    ],
  });
  assert.equal(countAdjacentMines(state, { x: 3, y: 2, z: 2 }), 2);
  assert.equal(getVisibleClue(state, 3, 2), null);
  const revealed = dig(state, "frontDown");
  assert.equal(getVisibleClue(revealed, 3, 3), null);
  assert.equal(getVisibleClue(revealed, 2, 2), null);
  assert.deepEqual(getVisibleClue(revealed, 3, 2), {
    coord: { x: 3, y: 2, z: 2 },
    surfaceY: 2,
    count: 2,
  });
});

test("upper clues remain visible after a lower cell is opened", () => {
  const base = createGame({
    mines: [
      { x: 2, y: 2, z: 2 },
      { x: 2, y: 1, z: 2 },
    ],
  });
  const fixture: GameState = {
    ...base,
    cells: base.cells.map((cell) =>
      cell.x === 3 && cell.z === 2 && (cell.y === 2 || cell.y === 1)
        ? { ...cell, solid: false }
        : cell,
    ),
  };

  assert.deepEqual(getVisibleClues(fixture, 3, 2), [
    { coord: { x: 3, y: 2, z: 2 }, surfaceY: 2, count: 1 },
    { coord: { x: 3, y: 1, z: 2 }, surfaceY: 1, count: 1 },
  ]);
  const clearedMines: GameState = {
    ...fixture,
    cells: fixture.cells.map((cell) => (cell.mine ? { ...cell, solid: false } : cell)),
  };
  assert.deepEqual(
    getVisibleClues(clearedMines, 3, 2).map(({ count }) => count),
    [1, 1],
  );
});

test("digging a zero floods same-layer zeroes and boundary numbers but preserves flags", () => {
  const base = createGame({
    size: { width: 3, depth: 3, layers: 2 },
    mines: [{ x: 0, y: 1, z: 2 }],
  });
  const cells = base.cells.map((cell) =>
    cell.x === 2 && cell.y === 1 && cell.z === 2 ? { ...cell, flagged: true } : cell,
  );
  const fixture: GameState = { ...base, cells };
  assert.equal(countAdjacentMines(fixture, { x: 1, y: 1, z: 0 }), 0);

  const flooded = dig(fixture, "frontDown");
  assert.equal(getCell(flooded, { x: 1, y: 1, z: 0 })?.solid, false);
  assert.equal(getCell(flooded, { x: 1, y: 1, z: 2 })?.solid, false);
  assert.equal(getCell(flooded, { x: 0, y: 1, z: 1 })?.solid, false);
  assert.equal(getCell(flooded, { x: 0, y: 1, z: 2 })?.solid, true);
  assert.equal(getCell(flooded, { x: 2, y: 1, z: 2 })?.solid, true);
  assert.equal(getCell(flooded, { x: 2, y: 1, z: 2 })?.flagged, true);
  assert.ok(flooded.cells.filter((cell) => cell.y === 0).every((cell) => cell.solid));
});

test("correctly flagging every mine clears only that floor", () => {
  const state = createGame({
    size: { width: 3, depth: 3, layers: 2 },
    mines: [
      { x: 1, y: 1, z: 0 },
      { x: 2, y: 1, z: 1 },
      { x: 1, y: 0, z: 1 },
    ],
  });
  const oneFlag = toggleFlag(state, "frontDown");
  assert.equal(getCell(oneFlag, { x: 1, y: 1, z: 0 })?.solid, true);

  const cleared = toggleFlag(oneFlag, "rightDown");
  assert.equal(getCell(cleared, { x: 1, y: 1, z: 0 })?.solid, false);
  assert.equal(getCell(cleared, { x: 2, y: 1, z: 1 })?.solid, false);
  assert.equal(getCell(cleared, { x: 1, y: 1, z: 0 })?.flagged, false);
  assert.equal(getCell(cleared, { x: 1, y: 0, z: 1 })?.solid, true);
  // Clues retain the original floor layout even after correctly flagged mines are purged.
  assert.equal(countAdjacentMines(cleared, { x: 1, y: 1, z: 1 }), 2);
});

test("an incorrect flag blocks a floor purge until it is removed", () => {
  const state = createGame({
    size: { width: 3, depth: 3, layers: 1 },
    mines: [{ x: 1, y: 0, z: 0 }],
  });
  const wrongFlag = toggleFlag(state, "rightDown");
  const allMinesFlagged = toggleFlag(wrongFlag, "frontDown");
  assert.equal(getCell(allMinesFlagged, { x: 1, y: 0, z: 0 })?.solid, true);

  const corrected = toggleFlag(allMinesFlagged, "rightDown");
  assert.equal(getCell(corrected, { x: 1, y: 0, z: 0 })?.solid, false);
  assert.equal(getCell(corrected, { x: 2, y: 0, z: 1 })?.flagged, false);
});

test("mines lose, clearing all safe blocks wins, and restart restores the fixture", () => {
  const lossFixture = createGame({
    size: { width: 1, depth: 1, layers: 1 },
    mines: [{ x: 0, y: 0, z: 0 }],
  });
  const lost = dig(lossFixture, "down");
  assert.equal(lost.status, "lost");
  assert.equal(getCell(lost, { x: 0, y: 0, z: 0 })?.solid, false);
  assert.equal(getVisibleClue(lost, 0, 0), null);

  const winFixture = createGame({ size: { width: 1, depth: 1, layers: 1 }, mines: [] });
  const won = dig(winFixture, "down");
  assert.equal(won.status, "won");
  const restarted = restartGame(won);
  assert.equal(restarted.status, "playing");
  assert.equal(restarted.player.footY, 1);
  assert.equal(getCell(restarted, { x: 0, y: 0, z: 0 })?.solid, true);
});
