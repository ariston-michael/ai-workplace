import { mapObstacles, nearestWalkable, stopPoint, walkingRoute, type MapSize, type MapStop, type Point } from "@/lib/workplace/office-map";
import { walkFacing } from "@/lib/workplace/characters";
import type { WorkerMovement } from "@/lib/workplace/movement";

/** A visual queue of observed events. This never changes a job, its runtime, or billing. */
export class OfficeWalker {
  private position: Point;
  private queue: MapStop[] = [];
  private active: MapStop | null = null;
  private location: MapStop;
  private running = false;
  private disposed = false;
  private animation: Animation | null = null;
  private generation = 0;
  private lastEvent: string | null;
  private lastJob: string | undefined;
  /** Set when the worker is walking out for good; onGone fires at the door. */
  private leavingOffice = false;
  private preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  private finishForReducedMotion = () => { if (this.preference.matches && this.animation?.playState === "running") this.animation.finish(); };

  constructor(private element: HTMLElement, private desk: string, private size: MapSize, movement: WorkerMovement, arriving: boolean, private onGone?: () => void) {
    // On load a finished worker is already back at its desk (kept workers) or at reception.
    this.location = arriving ? "door" : (movement.kind === "returned" || movement.kind === "failed") && movement.after === "leave" ? "reception" : "workstation";
    this.position = stopPoint(this.location, this.desk, size);
    this.lastEvent = movement.eventKey;
    this.lastJob = movement.jobId;
    this.place();
    this.preference.addEventListener("change", this.finishForReducedMotion);
    if (arriving) {
      this.enqueue("workstation");
      if (movement.kind === "returned" || movement.kind === "failed") { this.enqueue("reception"); this.afterReport(movement); }
    } else if (movement.after === "leave") this.afterReport(movement);
  }

  /** After the report is at reception: back to the desk, or out through the door. */
  private afterReport(movement: WorkerMovement) {
    if (movement.after === "leave") { this.leavingOffice = true; this.enqueue("door"); }
    else this.enqueue("workstation");
  }

  update(movement: WorkerMovement) {
    if (movement.eventKey === this.lastEvent && movement.jobId === this.lastJob) return;
    const newJob = movement.jobId !== this.lastJob;
    if (movement.kind === "at_desk" && !movement.jobId && this.lastJob) {
      // Reset or removed history: discard queued visual events along with the saved job.
      this.generation++; this.animation?.cancel(); this.animation = null; this.queue = []; this.active = null; this.running = false;
      this.location = "workstation"; this.position = stopPoint("workstation", this.desk, this.size); this.place();
    }
    this.lastEvent = movement.eventKey; this.lastJob = movement.jobId;
    if (movement.kind === "assigned" || movement.kind === "working") this.enqueue("workstation");
    if (movement.kind === "returned" || movement.kind === "failed") {
      // A short job may finish between polls. Its saved departure still precedes the return.
      if (newJob && movement.departed) this.enqueue("workstation");
      this.enqueue("reception");
      this.afterReport(movement);
    } else if (movement.after === "leave") this.afterReport(movement); // released while idle
  }

  resize(size: MapSize) {
    if (size.width === this.size.width && size.height === this.size.height) return;
    const computed = getComputedStyle(this.element);
    const position = { x: parseFloat(computed.left), y: parseFloat(computed.top) };
    this.generation++;
    this.animation?.cancel(); this.animation = null;
    if (this.active) this.queue.unshift(this.active);
    this.active = null; this.running = false; this.size = size;
    this.position = nearestWalkable(position, mapObstacles(this.desk, size), size);
    if (!this.queue.length) this.position = stopPoint(this.location, this.desk, size);
    this.place(); void this.run();
  }

  private place() {
    this.element.style.left = `${this.position.x / this.size.width * 100}%`;
    this.element.style.top = `${this.position.y / this.size.height * 100}%`;
    this.element.dataset.positioned = "true";
    this.element.dataset.facing = "south";
    this.element.dataset.mapStop = this.location;
    this.element.dataset.travel = "idle";
  }

  private enqueue(stop: MapStop) {
    const tail = this.queue.at(-1) ?? this.active ?? this.location;
    if (tail === stop) return;
    this.queue.push(stop); void this.run();
  }

  private async run() {
    if (this.running || this.disposed) return;
    this.running = true;
    const generation = this.generation;
    while (this.queue.length && !this.disposed) {
      const stop = this.queue.shift()!;
      this.active = stop;
      const target = stopPoint(stop, this.desk, this.size);
      const route = walkingRoute(this.position, target, mapObstacles(this.desk, this.size), this.size);
      if (!route.length) { this.element.dataset.travel = "blocked"; this.active = null; continue; }
      const distances = route.map((point, index) => index ? Math.hypot(point.x - route[index - 1].x, point.y - route[index - 1].y) : 0);
      const total = distances.reduce((sum, distance) => sum + distance, 0);
      this.element.dataset.destination = stop;
      if (total > 0 && !this.preference.matches) {
        this.element.dataset.travel = "walking";
        for (let index = 1; index < route.length; index++) {
          const from = route[index - 1], to = route[index];
          this.element.dataset.facing = walkFacing(from, to);
          this.animation = this.element.animate([
            { left: `${from.x / this.size.width * 100}%`, top: `${from.y / this.size.height * 100}%` },
            { left: `${to.x / this.size.width * 100}%`, top: `${to.y / this.size.height * 100}%` },
          ], { duration: distances[index] / 165 * 1000, easing: "linear", fill: "forwards" });
          try { await this.animation.finished; } catch { return; }
          if (generation !== this.generation || this.disposed) return;
          this.element.style.left = `${to.x / this.size.width * 100}%`;
          this.element.style.top = `${to.y / this.size.height * 100}%`;
          this.animation.cancel(); this.animation = null;
          // Respect a preference changed during a route, not only at its start.
          if (this.preference.matches) break;
        }
      }
      this.position = target; this.location = stop; this.active = null;
      this.place(); this.animation?.cancel(); this.animation = null;
      if (stop === "door" && this.leavingOffice) {
        this.element.dataset.gone = "true";
        this.running = false;
        this.onGone?.();
        return;
      }
      // Hand the report over at reception before walking on.
      if (stop === "reception" && this.queue.length && !this.preference.matches) {
        this.element.dataset.travel = "handover";
        await new Promise(resolve => setTimeout(resolve, 1400));
        if (generation !== this.generation || this.disposed) return;
      }
    }
    this.running = false;
  }

  dispose() {
    this.disposed = true; this.generation++; this.animation?.cancel();
    this.preference.removeEventListener("change", this.finishForReducedMotion);
  }
}
