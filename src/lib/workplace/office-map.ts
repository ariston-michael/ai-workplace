/** Shared furniture geometry: rendering and walking use the same rectangles. */
export type Point = { x: number; y: number };
export type Rect = Point & { width: number; height: number; id: string };
export type MapSize = { width: number; height: number };
export type MapStop = "door" | "workstation" | "reception";
export const MAP_WIDTH = 1000;
export const MAP_HEIGHT = 720;

export const MAP_STATIONS = [
  { id: "workstation-01", label: "Cubicle 01", desk: { id: "desk-inspector", x: 120, y: 220, width: 210, height: 85 }, chair: { id: "chair-inspector", x: 195, y: 150, width: 60, height: 50 }, seat: { x: 225, y: 175 }, report: { x: 500, y: 470 } },
  { id: "desk-02", label: "Cubicle 02", desk: { id: "desk-02", x: 670, y: 220, width: 210, height: 85 }, chair: { id: "chair-02", x: 745, y: 150, width: 60, height: 50 }, seat: { x: 775, y: 175 }, report: { x: 500, y: 560 } },
  { id: "desk-03", label: "Cubicle 03", desk: { id: "desk-03", x: 670, y: 545, width: 210, height: 85 }, chair: { id: "chair-03", x: 745, y: 475, width: 60, height: 50 }, seat: { x: 775, y: 500 }, report: { x: 500, y: 650 } },
] as const;
export const RECEPTION = { desk: { id: "reception", x: 110, y: 565, width: 235, height: 70 }, chair: { id: "chair-dispatcher", x: 205, y: 490, width: 60, height: 50 }, seat: { x: 235, y: 515 } };
export const MAP_DECOR: Rect[] = [
  { id: "wall-01-north", x: 90, y: 110, width: 270, height: 12 },
  { id: "wall-01-side", x: 78, y: 110, width: 12, height: 215 },
  { id: "wall-02-north", x: 640, y: 110, width: 270, height: 12 },
  { id: "wall-02-side", x: 910, y: 110, width: 12, height: 215 },
  { id: "wall-03-north", x: 640, y: 435, width: 270, height: 12 },
  { id: "wall-03-side", x: 910, y: 435, width: 12, height: 215 },
  { id: "plant-north", x: 920, y: 25, width: 50, height: 55 },
  { id: "plant-south", x: 25, y: 610, width: 50, height: 55 },
  { id: "window", x: 350, y: 8, width: 300, height: 52 },
  { id: "console", x: 70, y: 15, width: 120, height: 65 },
  { id: "notice", x: 750, y: 18, width: 90, height: 52 },
];

// Map-only characters are 39 × 45 CSS px; clearance includes outlines/shadows.
export const WALK_CLEARANCE = { x: 23, y: 26 };
export function mapPoint(point: Point, size: MapSize): Point {
  return { x: point.x * size.width / MAP_WIDTH, y: point.y * size.height / MAP_HEIGHT };
}
export function mapRect(rect: Rect, size: MapSize): Rect {
  return { ...mapPoint(rect, size), id: rect.id, width: rect.width * size.width / MAP_WIDTH, height: rect.height * size.height / MAP_HEIGHT };
}
export function workstation(desk: string) {
  return MAP_STATIONS.find(station => station.id === desk) ?? MAP_STATIONS[0];
}
export function stopPoint(stop: MapStop, desk: string, size: MapSize): Point {
  if (stop === "door") return { x: size.width * .5, y: size.height - WALK_CLEARANCE.y };
  return mapPoint(stop === "reception" ? workstation(desk).report : workstation(desk).seat, size);
}
export function mapObstacles(desk: string, size: MapSize): Rect[] {
  // A worker can approach/sit in its own chair; other chairs remain obstacles.
  const ownChair = workstation(desk).chair.id;
  return [...MAP_STATIONS.flatMap(station => [station.desk, station.chair]), RECEPTION.desk, RECEPTION.chair, ...MAP_DECOR]
    .filter(rect => rect.id !== ownChair).map(rect => mapRect(rect, size));
}
export function expandObstacle(rect: Rect): Rect {
  return { ...rect, x: rect.x - WALK_CLEARANCE.x, y: rect.y - WALK_CLEARANCE.y,
    width: rect.width + 2 * WALK_CLEARANCE.x, height: rect.height + 2 * WALK_CLEARANCE.y };
}
function inside(point: Point, rect: Rect) {
  return point.x > rect.x && point.x < rect.x + rect.width && point.y > rect.y && point.y < rect.y + rect.height;
}
function inBounds(point: Point, size: MapSize) {
  return point.x >= WALK_CLEARANCE.x && point.x <= size.width - WALK_CLEARANCE.x
    && point.y >= WALK_CLEARANCE.y && point.y <= size.height - WALK_CLEARANCE.y;
}
export function segmentClear(a: Point, b: Point, obstacles: Rect[]): boolean {
  if (a.x !== b.x && a.y !== b.y) return false;
  return !obstacles.map(expandObstacle).some(rect => {
    if (a.x === b.x) return a.x > rect.x && a.x < rect.x + rect.width
      && Math.max(a.y, b.y) > rect.y && Math.min(a.y, b.y) < rect.y + rect.height;
    return a.y > rect.y && a.y < rect.y + rect.height
      && Math.max(a.x, b.x) > rect.x && Math.min(a.x, b.x) < rect.x + rect.width;
  });
}

/** Rectilinear A*: turns are in free aisles, never diagonal shortcuts through furniture. */
export function walkingRoute(start: Point, end: Point, obstacles: Rect[], size: MapSize): Point[] {
  const expanded = obstacles.map(expandObstacle);
  const free = (point: Point) => inBounds(point, size) && !expanded.some(rect => inside(point, rect));
  if (!free(start) || !free(end)) return [];
  const unique = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);
  const xs = unique([start.x, end.x, WALK_CLEARANCE.x, size.width - WALK_CLEARANCE.x,
    ...expanded.flatMap(rect => [rect.x - .5, rect.x + rect.width + .5])]).filter(x => x >= WALK_CLEARANCE.x && x <= size.width - WALK_CLEARANCE.x);
  const ys = unique([start.y, end.y, WALK_CLEARANCE.y, size.height - WALK_CLEARANCE.y,
    ...expanded.flatMap(rect => [rect.y - .5, rect.y + rect.height + .5])]).filter(y => y >= WALK_CLEARANCE.y && y <= size.height - WALK_CLEARANCE.y);
  const nodes = xs.flatMap(x => ys.map(y => ({ x, y })));
  const startIndex = xs.indexOf(start.x) * ys.length + ys.indexOf(start.y);
  const endIndex = xs.indexOf(end.x) * ys.length + ys.indexOf(end.y);
  const valid = nodes.map(free);
  const distance = new Map<number, number>([[startIndex, 0]]);
  const previous = new Map<number, number>();
  const open = new Set([startIndex]);
  const heuristic = (index: number) => Math.abs(nodes[index].x - end.x) + Math.abs(nodes[index].y - end.y);
  while (open.size) {
    let current = -1, score = Infinity;
    for (const candidate of open) {
      const value = distance.get(candidate)! + heuristic(candidate);
      if (value < score) { current = candidate; score = value; }
    }
    if (current === endIndex) {
      const route = [nodes[current]];
      while (previous.has(current)) { current = previous.get(current)!; route.unshift(nodes[current]); }
      return route.filter((point, index) => index === 0 || index === route.length - 1
        || !((route[index - 1].x === point.x && point.x === route[index + 1].x)
          || (route[index - 1].y === point.y && point.y === route[index + 1].y)));
    }
    open.delete(current);
    const column = Math.floor(current / ys.length), row = current % ys.length;
    const neighbors = [column > 0 ? current - ys.length : -1, column < xs.length - 1 ? current + ys.length : -1,
      row > 0 ? current - 1 : -1, row < ys.length - 1 ? current + 1 : -1];
    for (const neighbor of neighbors) {
      if (neighbor < 0 || !valid[neighbor] || !segmentClear(nodes[current], nodes[neighbor], obstacles)) continue;
      const nextDistance = distance.get(current)! + Math.abs(nodes[current].x - nodes[neighbor].x) + Math.abs(nodes[current].y - nodes[neighbor].y);
      if (nextDistance >= (distance.get(neighbor) ?? Infinity)) continue;
      distance.set(neighbor, nextDistance); previous.set(neighbor, current); open.add(neighbor);
    }
  }
  return []; // An obstructed route must never fall back to walking through a table.
}

/** Reposition safely if resizing brings a fixed-size sprite too close to furniture. */
export function nearestWalkable(point: Point, obstacles: Rect[], size: MapSize): Point {
  const expanded = obstacles.map(expandObstacle);
  const clamp = (value: Point) => ({ x: Math.max(WALK_CLEARANCE.x, Math.min(size.width - WALK_CLEARANCE.x, value.x)), y: Math.max(WALK_CLEARANCE.y, Math.min(size.height - WALK_CLEARANCE.y, value.y)) });
  const origin = clamp(point);
  const xs = [origin.x, WALK_CLEARANCE.x, size.width - WALK_CLEARANCE.x, ...expanded.flatMap(rect => [rect.x - .5, rect.x + rect.width + .5])];
  const ys = [origin.y, WALK_CLEARANCE.y, size.height - WALK_CLEARANCE.y, ...expanded.flatMap(rect => [rect.y - .5, rect.y + rect.height + .5])];
  return xs.flatMap(x => ys.map(y => ({ x, y }))).filter(value => inBounds(value, size) && !expanded.some(rect => inside(value, rect)))
    .sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y))[0] ?? origin;
}
