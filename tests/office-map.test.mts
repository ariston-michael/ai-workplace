import { test } from "node:test";
import assert from "node:assert/strict";
import { MAP_STATIONS, mapObstacles, walkingRoute, stopPoint, segmentClear, type MapStop } from "../src/lib/workplace/office-map.ts";

for (const size of [{ width: 760, height: 544 }, { width: 540, height: 544 }, { width: 322, height: 524 }, { width: 252, height: 524 }]) {
  test(`walking routes clear furniture at ${size.width} × ${size.height}`, () => {
    for (const station of MAP_STATIONS) {
      const obstacles = mapObstacles(station.id, size);
      for (const [from, to] of [["door", "workstation"], ["workstation", "reception"], ["reception", "workstation"], ["reception", "door"]] as [MapStop, MapStop][]) {
        const start = stopPoint(from, station.id, size), end = stopPoint(to, station.id, size);
        const route = walkingRoute(start, end, obstacles, size);
        assert.ok(route.length > 1, `${station.id}: ${from} → ${to} must have a route`);
        assert.deepEqual(route[0], start);
        assert.deepEqual(route.at(-1), end);
        for (let index = 1; index < route.length; index++) {
          assert.ok(segmentClear(route[index - 1], route[index], obstacles), `${station.id}: segment ${index} intersects furniture or cuts a corner`);
        }
      }
    }
  });
}

test("compact desks leave the central aisle open for larger characters", () => {
  for (const station of MAP_STATIONS) assert.ok(station.desk.width <= 220);
});

test("a blocked route never falls back to a straight line through furniture", () => {
  const size = { width: 400, height: 300 };
  const wall = { id: "wall", x: 0, y: 130, width: 400, height: 30 };
  assert.deepEqual(walkingRoute({ x: 100, y: 60 }, { x: 100, y: 240 }, [wall], size), []);
  assert.deepEqual(walkingRoute({ x: 100, y: 60 }, { x: 100, y: 145 }, [wall], size), []);
});

test("report pickup points are distinct, beside reception, and leave the Dispatcher seated", () => {
  const size = { width: 322, height: 524 };
  const reports = MAP_STATIONS.map(station => stopPoint("reception", station.id, size));
  assert.equal(new Set(reports.map(point => `${point.x}:${point.y}`)).size, 3);
  for (let index = 1; index < reports.length; index++) assert.ok(reports[index].y - reports[index - 1].y >= 44);
});
