import { animate } from "motion";
import {
  MODES, MODE_INFO, DURATIONS, RACE_LENGTH, NAME_MAX, cleanName, isRoomCode,
  type ErrorCode, type Mode, type ResultsMsg,
} from "@drift/shared";
import type { Session } from "../net/session";

const NAME_KEY = "drift.name";
const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");
const fmt = (n: number) => Math.round(n).toLocaleString("tr-TR");
const ERRORS: Record<ErrorCode, string> = {
  not_found: "Bu kodda bir oda yok.",
  full: "Oda dolu (en çok 8 kişi).",
  busy: "Sunucu şu an çok yoğun, birazdan dene.",
  bad_name: "Geçerli bir isim yaz.",
  not_host: "Bunu yalnız oda sahibi yapabilir.",
};
const MODE_ICON: Record<Mode, string> = { battle: "🔥", race: "🏁", ghost: "👻", free: "🌄" };

type Attrs = Record<string, string | number | boolean | ((e: Event) => void)>;
/** Tiny DOM builder: text always goes through textContent, never innerHTML. */
function h(tag: string, attrs: Attrs = {}, ...kids: (Node | string | null | false)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (k === "style") el.setAttribute("style", String(v));
    else if (typeof v === "boolean") {
      if (v) el.setAttribute(k, "");
    } else el.setAttribute(k, String(v));
  }
  for (const k of kids) if (k !== null && k !== false) el.append(k);
  return el;
}

function storedName(): string {
  try {
    return cleanName(localStorage.getItem(NAME_KEY)) ?? "";
  } catch {
    return "";
  }
}
function saveName(n: string): void {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* ignore */
  }
}

function roomFromUrl(): string | null {
  const v = new URLSearchParams(location.search).get("room")?.toUpperCase() ?? null;
  return isRoomCode(v) ? v : null;
}

/** Menu → lobby → live board → results. Owns #mp, #mpBtn and #board. */
export class LobbyUi {
  private root = document.getElementById("mp")!;
  private btn = document.getElementById("mpBtn")!;
  private board = document.getElementById("board")!;
  private open = false;
  private error = "";
  private showResults = false;
  private busy = false;

  constructor(private s: Session) {
    this.btn.addEventListener("click", () => this.toggle(true));
    // Typing in the panel must not steer the car, mute, toggle extreme or switch cameras.
    for (const ev of ["keydown", "keyup"]) this.root.addEventListener(ev, (e) => e.stopPropagation());
    addEventListener("keydown", (e) => {
      if (e.key === "Escape" || e.key === "Tab") {
        e.preventDefault();
        this.toggle(!this.open);
      }
    });
    if (roomFromUrl()) this.toggle(true);
    this.render();
  }

  /** True while a panel covers the screen (the game ignores arrow keys then). */
  get visible(): boolean {
    return this.open;
  }

  toggle(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.error = "";
    this.render();
    if (open) animate(this.root, { opacity: [0, 1], scale: [0.96, 1] }, { duration: 0.25, ease: [0.2, 0.9, 0.3, 1.2] });
  }

  onLobby(): void {
    this.busy = false;
    if (this.s.phase === "racing" && this.s.racing) this.open = false;
    if (!this.s.inRoom) this.showResults = false;
    else if (!this.s.racing) this.open = true;
    this.render();
  }

  onResults(): void {
    if (this.s.phase === "racing") return; // interim standings mid-race: the live board shows them
    this.showResults = true;
    this.open = true;
    this.render();
    animate(this.root, { opacity: [0, 1], y: [30, 0] }, { duration: 0.35 });
  }

  /** A round I take part in begins: get out of the way. */
  onRound(): void {
    this.showResults = false;
    this.open = false;
    this.render();
  }

  onError(code: ErrorCode): void {
    this.busy = false;
    this.error = ERRORS[code];
    this.open = true;
    this.render();
  }

  private render(): void {
    this.btn.style.display = this.s.inRoom ? "none" : "block";
    this.root.style.display = this.open ? "flex" : "none";
    if (!this.open) return;
    const card = !this.s.inRoom ? this.menu() : this.showResults && this.s.results ? this.results(this.s.results) : this.lobby();
    this.root.replaceChildren(h("div", { class: "mp-scrim", onclick: () => !this.s.inRoom && this.toggle(false) }), card);
    card.querySelector<HTMLInputElement>("input[autofocus]")?.focus();
  }

  private errLine(): HTMLElement | null {
    return this.error ? h("div", { class: "mp-err", role: "alert" }, this.error) : null;
  }

  private menu(): HTMLElement {
    const fromUrl = roomFromUrl();
    const name = h("input", { class: "mp-input", maxlength: NAME_MAX, placeholder: "Adın", value: storedName(), autofocus: true, "aria-label": "Adın" }) as HTMLInputElement;
    const code = h("input", { class: "mp-input mp-code", maxlength: 4, placeholder: "KOD", value: fromUrl ?? "", "aria-label": "Oda kodu" }) as HTMLInputElement;
    code.addEventListener("input", () => (code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, "")));
    const getName = (): string | null => {
      const n = cleanName(name.value);
      if (!n) {
        this.error = ERRORS.bad_name;
        this.render();
        return null;
      }
      saveName(n);
      return n;
    };
    const create = () => {
      const n = getName();
      if (!n || this.busy) return;
      this.busy = true;
      this.s.create(n);
    };
    const join = () => {
      const n = getName();
      if (!n || this.busy) return;
      const c = code.value.trim().toUpperCase();
      if (!isRoomCode(c)) {
        this.error = "Oda kodu 4 karakter olmalı.";
        this.render();
        return;
      }
      this.busy = true;
      this.s.join(c, n);
    };
    code.addEventListener("keydown", (e) => (e as KeyboardEvent).key === "Enter" && join());
    name.addEventListener("keydown", (e) => (e as KeyboardEvent).key === "Enter" && (fromUrl ? join() : create()));
    return h("div", { class: "mp-card", role: "dialog", "aria-label": "Çok oyunculu" },
      h("div", { class: "mp-head" },
        h("div", { class: "mp-title" }, "ÇOK OYUNCULU"),
        h("button", { class: "mp-x", "aria-label": "Kapat", onclick: () => this.toggle(false) }, "✕")),
      h("p", { class: "mp-sub" }, "Arkadaşlarınla aynı yolda drift at. Oda kur, kodu paylaş."),
      name,
      h("div", { class: "mp-grid2" },
        h("button", { class: "mp-btn mp-primary", onclick: create, disabled: this.busy }, "Oda kur"),
        h("div", { class: "mp-join" }, code, h("button", { class: "mp-btn", onclick: join, disabled: this.busy }, "Katıl"))),
      this.errLine(),
      h("div", { class: "mp-foot" }, "Tek başına sürmek için paneli kapat. Esc: paneli aç/kapat · C: kamera"));
  }

  private lobby(): HTMLElement {
    const s = this.s;
    const host = s.isHost;
    const link = `${location.origin}/?room=${s.room}`;
    const copy = h("button", { class: "mp-chip", onclick: () => {
      navigator.clipboard?.writeText(link).then(() => (copy.textContent = "Kopyalandı ✓"), () => (copy.textContent = link));
    } }, "Davet linkini kopyala");

    const players = h("ul", { class: "mp-players" },
      ...s.players.map((p) =>
        h("li", { class: p.id === s.me ? "me" : "" },
          h("span", { class: "dot", style: `background:${hex(p.color)}` }),
          h("span", { class: "nm" }, p.name),
          p.id === s.host ? h("span", { class: "tag" }, "👑 kurucu") : null,
          p.id === s.me ? h("span", { class: "tag you" }, "sen") : null,
          s.phase === "racing" && !s.racers.has(p.id) ? h("span", { class: "tag" }, "sırada") : null)));

    const modes = h("div", { class: "mp-modes" },
      ...MODES.map((m) =>
        h("button", {
          class: `mp-mode${s.mode === m ? " on" : ""}`, disabled: !host || s.phase === "racing", "aria-pressed": s.mode === m ? "true" : "false",
          onclick: () => s.configure(m, s.extreme, s.duration),
        },
        h("span", { class: "ic" }, MODE_ICON[m]),
        h("span", { class: "mn" }, MODE_INFO[m].name),
        h("span", { class: "md" }, MODE_INFO[m].desc))));

    const timed = MODE_INFO[s.mode].timed;
    const opts = h("div", { class: "mp-opts" },
      timed
        ? h("div", { class: "mp-seg", role: "group", "aria-label": "Süre" },
            ...DURATIONS.map((d) => h("button", {
              class: s.duration === d ? "on" : "", disabled: !host || s.phase === "racing",
              onclick: () => s.configure(s.mode, s.extreme, d),
            }, `${d / 60} dk`)))
        : h("div", { class: "mp-note" }, MODE_INFO[s.mode].race ? `Mesafe: ${RACE_LENGTH / 1000} km` : "Süre yok, kurucu bitirir"),
      h("button", {
        class: `mp-toggle${s.extreme ? " on" : ""}`, disabled: !host || s.phase === "racing", role: "switch", "aria-checked": String(s.extreme),
        onclick: () => s.configure(s.mode, !s.extreme, s.duration),
      }, "🔥 EXTREME"));

    let action: HTMLElement;
    if (s.phase === "racing" && s.racing) {
      action = h("div", { class: "mp-actions" },
        h("button", { class: "mp-btn", onclick: () => this.toggle(false) }, "Sürüşe dön"),
        host ? h("button", { class: "mp-btn mp-danger", onclick: () => s.end() }, "Turu bitir") : null);
    } else if (s.phase === "racing") {
      action = h("div", { class: "mp-wait" }, "Tur sürüyor, bitince sen de katılacaksın…");
    } else if (host) {
      action = h("button", { class: "mp-btn mp-primary mp-go", onclick: () => s.start() }, `BAŞLAT · ${s.players.length} oyuncu`);
    } else {
      action = h("div", { class: "mp-wait" }, "Kurucunun başlatması bekleniyor…");
    }

    return h("div", { class: "mp-card mp-wide", role: "dialog", "aria-label": "Lobi" },
      h("div", { class: "mp-head" },
        h("div", {},
          h("div", { class: "mp-kicker" }, "ODA KODU"),
          h("div", { class: "mp-room" }, s.room ?? "")),
        h("div", { class: "mp-headr" }, copy, h("button", { class: "mp-chip", onclick: () => s.leave() }, "Odadan çık"))),
      h("div", { class: "mp-bento" },
        h("section", { class: "mp-tile" }, h("div", { class: "mp-kicker" }, `OYUNCULAR ${s.players.length}/8`), players),
        h("section", { class: "mp-tile mp-tile-wide" }, h("div", { class: "mp-kicker" }, host ? "MOD SEÇ" : "MOD"), modes, opts)),
      this.errLine(),
      action);
  }

  private results(r: ResultsMsg): HTMLElement {
    const s = this.s;
    const race = MODE_INFO[r.mode].race;
    const medal = ["🥇", "🥈", "🥉"];
    const rows = r.ranking.map((p, i) =>
      h("li", { class: p.id === s.me ? "me" : "", style: `--c:${hex(p.color)}` },
        h("span", { class: "pos" }, medal[i] ?? String(i + 1)),
        h("span", { class: "nm" }, p.name),
        h("span", { class: "val" },
          race ? (p.finish !== null ? `${p.finish.toFixed(2)} sn` : `${(p.dist / 1000).toFixed(2)} km · DNF`) : fmt(p.score))));
    const mine = r.ranking.findIndex((p) => p.id === s.me);
    const done = s.phase !== "racing";
    return h("div", { class: "mp-card mp-results", role: "dialog", "aria-label": "Sonuçlar" },
      h("div", { class: "mp-kicker" }, `${MODE_INFO[r.mode].name.toUpperCase()} · ${done ? "SONUÇLAR" : "ANLIK SIRALAMA"}`),
      h("div", { class: "mp-title big" }, mine === 0 ? "KAZANDIN!" : mine > 0 ? `${mine + 1}. oldun` : "Tur bitti"),
      h("ol", { class: "mp-rank" }, ...rows),
      h("div", { class: "mp-actions" },
        done
          ? h("button", { class: "mp-btn", onclick: () => { this.showResults = false; this.render(); } }, "Lobiye dön")
          : h("button", { class: "mp-btn", onclick: () => { this.showResults = false; this.toggle(false); } }, "Sürüşe dön"),
        done && s.isHost ? h("button", { class: "mp-btn mp-primary", onclick: () => { this.showResults = false; s.start(); } }, "Tekrar başlat") : null));
  }

  /** Compact live board during a round. */
  updateBoard(rows: { name: string; color: number; score: number; s: number; me: boolean }[], mode: Mode | null, timeLeft: number | null, mySpot: number): void {
    if (!mode) {
      if (this.board.style.display !== "none") this.board.style.display = "none";
      return;
    }
    this.board.style.display = "block";
    const race = MODE_INFO[mode].race;
    const head = timeLeft !== null
      ? `${Math.floor(timeLeft / 60)}:${String(Math.floor(timeLeft % 60)).padStart(2, "0")}`
      : race ? `${Math.max(0, (RACE_LENGTH - mySpot) / 1000).toFixed(2)} km kaldı` : MODE_INFO[mode].name;
    const key = head + rows.map((r) => `${r.name}${Math.round(race ? r.s : r.score)}`).join("|");
    if (this.board.dataset.key === key) return;
    this.board.dataset.key = key;
    this.board.replaceChildren(
      h("div", { class: `bd-head${timeLeft !== null && timeLeft < 10 ? " hot" : ""}` }, head),
      ...rows.map((r, i) =>
        h("div", { class: `bd-row${r.me ? " me" : ""}` },
          h("span", { class: "pos" }, String(i + 1)),
          h("span", { class: "dot", style: `background:${hex(r.color)}` }),
          h("span", { class: "nm" }, r.name),
          h("span", { class: "val" }, race ? `${(r.s / 1000).toFixed(2)} km` : fmt(r.score)))));
  }
}
