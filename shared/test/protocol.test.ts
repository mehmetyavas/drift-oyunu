import { describe, it, expect } from "vitest";
import { parseMessage, encode, type Message } from "../src/protocol";

describe("parseMessage", () => {
  it("parses a valid input message", () => {
    expect(parseMessage('{"t":"input","steer":0.5,"brake":false,"nitro":true,"seq":3}')).toEqual({
      t: "input", steer: 0.5, brake: false, nitro: true, seq: 3,
    });
  });
  it("clamps steer and rejects non-numbers", () => {
    expect((parseMessage('{"t":"input","steer":2,"brake":false,"nitro":false,"seq":1}') as any).steer).toBe(1);
    expect((parseMessage('{"t":"input","steer":-5,"brake":false,"nitro":false,"seq":1}') as any).steer).toBe(-1);
    expect(parseMessage('{"t":"input","steer":"x","brake":false,"nitro":false,"seq":1}')).toBeNull();
  });
  it("rejects garbage", () => {
    expect(parseMessage("not json")).toBeNull();
    expect(parseMessage('{"t":"nope"}')).toBeNull();
    expect(parseMessage('{"t":"hello","role":"admin"}')).toBeNull();
    expect(parseMessage("null")).toBeNull();
  });
  it("round-trips every message type", () => {
    const msgs: Message[] = [
      { t: "hello", role: "game" },
      { t: "input", steer: -0.25, brake: true, nitro: false, seq: 9 },
      { t: "calibrate" },
      { t: "toggleMode" },
      { t: "status", score: 1, combo: 0, multiplier: 1, extreme: true },
      { t: "haptic", kind: "comboUp" },
      { t: "haptic", kind: "drift" },
      { t: "status", score: 10, combo: 5, multiplier: 2 },
      { t: "peer", role: "controller", connected: true },
    ];
    for (const m of msgs) expect(parseMessage(encode(m))).toEqual(m);
  });
});

describe("multiplayer messages", () => {
  const rt = (m: Message) => parseMessage(encode(m));
  it("round-trips the room protocol", () => {
    const msgs: Message[] = [
      { t: "hello", role: "controller", pair: "ABC234" },
      { t: "pair", code: "ZZ99AB" },
      { t: "camera" },
      { t: "join", room: null, name: "Mehmet" },
      { t: "join", room: "AB23", name: "Emre" },
      { t: "leave" },
      { t: "config", mode: "race", extreme: true, duration: 180 },
      { t: "start" },
      { t: "end" },
      { t: "finish" },
      { t: "lobby", room: "AB23", you: "a1", host: "a1", players: [{ id: "a1", name: "X", color: 0xff0000 }], mode: "ghost", extreme: false, duration: 120, phase: "lobby", racers: [] },
      // Seeds use the full 31-bit range: a regression once dropped every round message.
      { t: "round", seed: 2 ** 31 - 1, mode: "battle", extreme: false, duration: 180, startIn: 4000, grid: ["a1", "b2"] },
      { t: "round", seed: 936443404, mode: "free", extreme: true, duration: 120, startIn: -5000, grid: ["a1"] },
      { t: "state", x: 1, z: 2, h: 0.1, vx: 3, vz: 4, yr: 0.2, st: -0.5, d: true, sc: 100, pd: 5, m: 2, s: 1234 },
      { t: "state", id: "b2", x: 1, z: 2, h: 0.1, vx: 3, vz: 4, yr: 0.2, st: 0, d: false, sc: 0, pd: 0, m: 1, s: 0 },
      { t: "results", mode: "race", ranking: [{ id: "a1", name: "X", color: 1, score: 5, dist: 4000, finish: 81.5 }, { id: "b2", name: "Y", color: 2, score: 9, dist: 3000, finish: null }] },
      { t: "error", code: "full" },
      { t: "status", score: 1, combo: 0, multiplier: 1, rank: 2, players: 4 },
    ];
    for (const m of msgs) expect(rt(m)).toEqual(m);
  });

  it("cleans names and rejects bad codes", () => {
    expect((parseMessage('{"t":"join","room":null,"name":"  a\\u0000b\\u202e  c  "}') as any).name).toBe("ab c");
    expect(parseMessage('{"t":"join","room":null,"name":"   "}')).toBeNull();
    expect(parseMessage('{"t":"join","room":"ab12","name":"x"}')).toBeNull(); // lower case / ambiguous
    expect(parseMessage('{"t":"join","room":"AB1O","name":"x"}')).toBeNull(); // 1 and O are not in the alphabet
    expect((parseMessage('{"t":"join","room":null,"name":"' + "x".repeat(40) + '"}') as any).name).toHaveLength(16);
    expect(parseMessage('{"t":"hello","role":"controller","pair":"<script>"}')).toEqual({ t: "hello", role: "controller" });
  });

  it("rejects non-finite or oversized car states", () => {
    const base = { t: "state", x: 1, z: 2, h: 0, vx: 0, vz: 0, yr: 0, st: 0, d: false, sc: 0, pd: 0, m: 1, s: 0 };
    expect(parseMessage(JSON.stringify({ ...base, x: 1e300 }))).toBeNull();
    expect(parseMessage(JSON.stringify({ ...base, d: "yes" }))).toBeNull();
    expect(parseMessage(JSON.stringify({ ...base, id: "../x" }))).toBeNull();
    expect(parseMessage("x".repeat(9000))).toBeNull();
  });
});
