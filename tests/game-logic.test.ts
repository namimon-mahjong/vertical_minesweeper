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
  movePlayer,
  restartGame,
  toggleFlag,
} = gameLogic;

type GameState = gameLogic.GameState;

test("default board is a full 7x7x3 cube with the player on top", () => {
  const state = createGame({ mines: [] });
  assert.deepEqual(state.size, { width: 7, depth: 7, layers: 3 });
  assert.equal(state.cells.length, 147);
  assert.ok(state.cells.every((cell) => cell.solid));
  assert.equal(state.player.footY, 3);
  assert.equal(state.activeTarget, "frontDown");
});

test("the four surrounding ground blocks, front wall and down can be acted upon", () => {
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
  assert.ok(getDigTargets(lowered).some((target) => target.kind === "front"));
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

test("movement faces world-fixed direction, allows unlimited descent, and blocks a two-step ascent", () => {
  const base = createGame({ mines: [] });
  const cells = base.cells.map((cell) =>
    cell.x === 3 && cell.z === 2 && cell.y >= 1 ? { ...cell, solid: false } : cell,
  );
  const fixture: GameState = { ...base, cells };
  const descended = movePlayer(fixture, "north");
  assert.deepEqual(descended.player, { x: 3, z: 2, footY: 1, facing: "north" });
  const blocked = movePlayer(descended, "south");
  assert.deepEqual(blocked.player, { x: 3, z: 2, footY: 1, facing: "south" });
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
  assert.equal(countAdjacentMines(cleared, { x: 1, y: 1, z: 1 }), 0);
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
