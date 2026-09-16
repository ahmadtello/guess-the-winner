import test from "node:test";
import assert from "node:assert/strict";
import {
  createDemo,
  canPredict,
  submitPick,
  revealWinner,
  standings,
  totals,
} from "../src/awards-model.js";
test("one answer per guest/category, replacement does not add a vote", () => {
  let s = createDemo();
  const before = totals(s, s.categories[2]).reduce(
    (sum, n) => sum + n.votes,
    0,
  );
  s = submitPick(s, "demo-0", "c2", "n2");
  s = submitPick(s, "demo-0", "c2", "n4");
  assert.equal(s.players[0].picks.c2, "n4");
  assert.equal(
    totals(s, s.categories[2]).reduce((sum, n) => sum + n.votes, 0),
    before,
  );
});
test("locked, future, invalid and finished predictions are rejected", () => {
  const s = createDemo();
  assert.equal(submitPick(s, "demo-0", "c3", "n1"), s);
  assert.equal(submitPick(s, "missing", "c2", "n1"), s);
  assert.equal(submitPick(s, "demo-0", "c2", "missing"), s);
  s.categories[2].status = "locked";
  assert.equal(submitPick(s, "demo-0", "c2", "n1"), s);
  s.categories[2].status = "open";
  s.finalPublished = true;
  assert.equal(canPredict(s, s.categories[2]), false);
});
test("reveal requires locked category, then scores actual winners rather than popular votes", () => {
  let s = createDemo();
  s.players = [
    { id: "a", name: "A", picks: { c0: "n1", c1: "n2", c2: "n3" } },
    { id: "b", name: "B", picks: { c0: "n1", c1: "n1", c2: "n1" } },
  ];
  assert.equal(revealWinner(s, "c2", "n3"), s);
  s.categories[2].status = "locked";
  s = revealWinner(s, "c2", "n3");
  assert.equal(standings(s)[0].score, 3);
  assert.equal(standings(s)[1].score, 1);
  assert.equal(s.categories[2].status, "revealed");
  assert.equal(revealWinner(s, "c2", "n1"), s);
});
test("all-category mode permits all open rounds and ties share competition rank", () => {
  const s = createDemo();
  s.categories[3].status = "open";
  assert.equal(canPredict(s, s.categories[3]), false);
  s.mode = "all";
  assert.equal(canPredict(s, s.categories[3]), true);
  s.players = [
    { id: "a", name: "A", picks: { c0: "n1" } },
    { id: "b", name: "B", picks: { c1: "n2" } },
    { id: "c", name: "C", picks: {} },
  ];
  assert.deepEqual(
    standings(s).map((p) => p.rank),
    [1, 1, 3],
  );
});
