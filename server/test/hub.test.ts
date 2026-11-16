import { describe, it, expect, beforeEach } from "vitest";
import { Hub, COUNTDOWN_MS, SPAWN_BEHIND, type Conn } from "../src/hub";
import { MAX_PLAYERS, RACE_LENGTH, RACE_GRACE, type Message, type StateMsg } from "@drift/shared";

class Fake implements Conn {
  inbox: Message[] = [];
  closed = false;
  send(m: Message) {
    this.inbox.push(m);
  }
  close() {
    this.closed = true;
  }
  last<T extends Message["t"]>(t: T): Extract<Message, { t: T }> | undefined {
    return [...this.inbox].reverse().find((m) => m.t === t) as Extract<Message, { t: T }> | undefined;
  }
  all<T extends Message["t"]>(t: T): Extract<Message, { t: T }>[] {
    return this.inbox.filter((m) => m.t === t) as Extract<Message, { t: T }>[];
  }
}

let now = 0;
let hub: Hub;
let seq = 0;
beforeEach(() => {
  now = 1_000_000;
  seq = 0;
  hub = new Hub(() => now, () => ((seq = (seq * 9301 + 49297) % 233280) / 233280));
});

function game(pair?: string): Fake {
  const c = new Fake();
  hub.connect(c);
  hub.message(c, pair ? { t: "hello", role: "game", pair } : { t: "hello", role: "game" });
  return c;
}
function controller(pair?: string): Fake {
  const c = new Fake();
  hub.connect(c);
  hub.message(c, pair ? { t: "hello", role: "controller", pair } : { t: "hello", role: "controller" });
  return c;
}
const state = (s: number, sc = 0): StateMsg => ({ t: "state", x: 0, z: s, h: 0, vx: 0, vz: 40, yr: 0, st: 0, d: false, sc, pd: 0, m: 1, s });

function room(n: number) {
  const host = game();
  hub.message(host, { t: "join", room: null, name: "Host" });
  const code = host.last("lobby")!.room;
  const others = Array.from({ length: n - 1 }, (_, i) => {
    const g = game();
    hub.message(g, { t: "join", room: code, name: `P${i + 2}` });
    return g;
  });
  return { host, others, code };
}

describe("pairing", () => {
  it("gives every game a pairing code and binds the controller that names it", () => {
    const a = game();
    const b = game();
    const codeA = a.last("pair")!.code;
    const ctl = controller(codeA);
    expect(a.last("peer")).toEqual({ t: "peer", role: "controller", connected: true });
    expect(b.last("peer")).toBeUndefined();
    hub.message(ctl, { t: "input", steer: 0.5, brake: false, nitro: false, seq: 1 });
    expect(a.last("input")?.steer).toBe(0.5);
    expect(b.last("input")).toBeUndefined();
  });

  it("keeps a requested code and rebinds the controller when the page comes back", () => {
    const a = game("ABCDEF");
    expect(a.last("pair")!.code).toBe("ABCDEF");
    const ctl = controller("ABCDEF");
    hub.disconnect(a);
    expect(ctl.last("peer")).toEqual({ t: "peer", role: "game", connected: false });
    const a2 = game("ABCDEF");
    expect(a2.last("peer")).toEqual({ t: "peer", role: "controller", connected: true });
  });

  it("a code-less controller binds to the newest game (LAN single player)", () => {
    game();
    const b = game();
    controller();
    expect(b.last("peer")?.connected).toBe(true);
  });

  it("a controller for an unknown code waits for that game", () => {
    const ctl = controller("ZZZZZZ");
    const other = game();
    expect(other.last("peer")).toBeUndefined();
    const g = game("ZZZZZZ");
    expect(g.last("peer")?.connected).toBe(true);
    expect(ctl.last("peer")?.connected).toBe(true);
  });

  it("routes haptics only to the paired controller", () => {
    const a = game();
    const b = game();
    const ca = controller(a.last("pair")!.code);
    const cb = controller(b.last("pair")!.code);
    hub.message(a, { t: "haptic", kind: "reset" });
    expect(ca.last("haptic")).toBeDefined();
    expect(cb.last("haptic")).toBeUndefined();
  });
});

describe("rooms", () => {
  it("creates a room with the creator as host and lets others join", () => {
    const { host, others, code } = room(3);
    const lobby = host.last("lobby")!;
    expect(lobby.room).toBe(code);
    expect(lobby.players.map((p) => p.name)).toEqual(["Host", "P2", "P3"]);
    expect(lobby.host).toBe(lobby.you);
    expect(new Set(lobby.players.map((p) => p.color)).size).toBe(3);
    expect(others[0].last("lobby")!.you).not.toBe(lobby.host);
  });

  it("rejects unknown and full rooms", () => {
    const g = game();
    hub.message(g, { t: "join", room: "QQQQ", name: "x" });
    expect(g.last("error")?.code).toBe("not_found");
    const { code } = room(MAX_PLAYERS);
    hub.message(g, { t: "join", room: code, name: "late" });
    expect(g.last("error")?.code).toBe("full");
  });

  it("only the host configures and starts", () => {
    const { host, others } = room(2);
    hub.message(others[0], { t: "config", mode: "race", extreme: true, duration: 120 });
    expect(others[0].last("error")?.code).toBe("not_host");
    hub.message(host, { t: "config", mode: "race", extreme: true, duration: 120 });
    expect(others[0].last("lobby")).toMatchObject({ mode: "race", extreme: true, duration: 120 });
    hub.message(others[0], { t: "start" });
    expect(others[0].last("round")).toBeUndefined();
  });

  it("hands host to the next player and deletes empty rooms", () => {
    const { host, others } = room(2);
    hub.disconnect(host);
    const lobby = others[0].last("lobby")!;
    expect(lobby.host).toBe(lobby.you);
    expect(hub.roomCount).toBe(1);
    hub.disconnect(others[0]);
    expect(hub.roomCount).toBe(0);
  });
});

describe("rounds", () => {
  it("starts with a shared seed, countdown and grid", () => {
    const { host, others } = room(2);
    hub.message(host, { t: "start" });
    const a = host.last("round")!, b = others[0].last("round")!;
    expect(a.seed).toBe(b.seed);
    expect(a.startIn).toBe(COUNTDOWN_MS);
    expect(a.grid).toHaveLength(2);
    expect(host.last("lobby")!.phase).toBe("racing");
  });

  it("relays car state to the others with the sender's id, rate-limited", () => {
    const { host, others } = room(2);
    hub.message(host, { t: "start" });
    const hostId = host.last("lobby")!.you;
    hub.message(host, state(10));
    hub.message(host, state(11)); // same instant: dropped
    expect(others[0].all("state")).toHaveLength(1);
    expect(others[0].last("state")).toMatchObject({ id: hostId, s: 10 });
    expect(host.all("state")).toHaveLength(0);
    now += 50;
    hub.message(host, state(12));
    expect(others[0].all("state")).toHaveLength(2);
  });

  it("ignores state outside a round", () => {
    const { host, others } = room(2);
    hub.message(host, state(10));
    expect(others[0].all("state")).toHaveLength(0);
  });

  it("ends a timed round and ranks by score", () => {
    const { host, others } = room(2);
    hub.message(host, { t: "config", mode: "battle", extreme: false, duration: 120 });
    hub.message(host, { t: "start" });
    hub.message(host, state(500, 100));
    now += 40;
    hub.message(others[0], state(400, 900));
    now += COUNTDOWN_MS + 119_000;
    hub.tick();
    expect(host.last("results")).toBeUndefined();
    now += 2000;
    hub.tick();
    const res = host.last("results")!;
    expect(res.ranking.map((r) => r.name)).toEqual(["P2", "Host"]);
    expect(host.last("lobby")!.phase).toBe("results");
  });

  it("race: finishers by time, then the grace period ends it", () => {
    const { host, others } = room(3);
    hub.message(host, { t: "config", mode: "race", extreme: false, duration: 180 });
    hub.message(host, { t: "start" });
    now += COUNTDOWN_MS + 80_000;
    hub.message(others[1], state(RACE_LENGTH + 5));
    hub.message(others[1], { t: "finish" });
    now += 3000;
    hub.message(host, state(RACE_LENGTH + 1));
    hub.message(host, { t: "finish" });
    hub.message(others[0], state(3000)); // still racing
    hub.message(others[0], { t: "finish" }); // too far from the line: ignored
    expect(host.last("lobby")!.phase).toBe("racing");
    now += RACE_GRACE * 1000;
    hub.tick();
    const res = host.last("results")!;
    expect(res.ranking.map((r) => r.name)).toEqual(["P3", "Host", "P2"]);
    expect(res.ranking[0].finish).toBeCloseTo(80, 0);
    expect(res.ranking[2].finish).toBeNull();
  });

  it("free mode never times out; late joiners get the running round", () => {
    const { host, code } = room(1);
    hub.message(host, { t: "config", mode: "free", extreme: false, duration: 120 });
    hub.message(host, { t: "start" });
    now += 3_600_000;
    hub.tick();
    expect(host.last("lobby")!.phase).toBe("racing");
    const late = game();
    hub.message(late, { t: "join", room: code, name: "Late" });
    expect(late.last("round")!.startIn).toBeLessThan(0);
    hub.message(host, { t: "end" });
    expect(late.last("results")!.ranking).toHaveLength(2);
  });

  it("late joiners drop into a running score round next to the last car", () => {
    const { host, others, code } = room(2);
    hub.message(host, { t: "start" });
    now += COUNTDOWN_MS + 30_000;
    hub.message(host, state(1500, 300));
    now += 40;
    hub.message(others[0], state(900, 100));
    const late = game();
    hub.message(late, { t: "join", room: code, name: "Late" });
    const r = late.last("round")!;
    expect(r.startIn).toBeLessThan(0);
    expect(r.spawn).toBe(900 - SPAWN_BEHIND);
    const lobby = late.last("lobby")!;
    expect(lobby.racers).toContain(lobby.you);
    expect(host.last("lobby")!.players.map((p) => p.name)).toContain("Late");
  });

  it("late joiners of a race watch the leader and race next time", () => {
    const { host, code } = room(1);
    hub.message(host, { t: "config", mode: "race", extreme: false, duration: 180 });
    hub.message(host, { t: "start" });
    now += COUNTDOWN_MS + 20_000;
    hub.message(host, state(2100));
    const late = game();
    hub.message(late, { t: "join", room: code, name: "Late" });
    expect(late.last("round")!.spawn).toBe(2100);
    expect(late.last("lobby")!.racers).not.toContain(late.last("lobby")!.you);
    hub.message(host, { t: "end" });
    hub.message(host, { t: "start" });
    expect(late.last("lobby")!.racers).toContain(late.last("lobby")!.you);
  });

  it("the host can start alone and others still get in", () => {
    const { host, code } = room(1);
    hub.message(host, { t: "start" });
    expect(host.last("round")!.grid).toHaveLength(1);
    const g = game();
    hub.message(g, { t: "join", room: code, name: "Friend" });
    expect(g.last("round")).toBeDefined();
  });
});

describe("abuse", () => {
  it("drops messages beyond the per-connection budget", () => {
    const a = game();
    const ctl = controller(a.last("pair")!.code);
    for (let i = 0; i < 500; i++) hub.message(ctl, { t: "input", steer: 0, brake: false, nitro: false, seq: i });
    expect(a.all("input").length).toBeLessThanOrEqual(121);
  });
});
