import QRCode from "qrcode";

const el = () => document.getElementById("pairing")!;
/** Bumped on every show/hide so a slow QR render cannot re-open a panel that was hidden meanwhile. */
let token = 0;

/** What the phone scans: the socket URL plus this page's pairing code. */
export function pairUrl(wsUrl: string, code?: string): string {
  return code ? `${wsUrl.replace(/\/$/, "")}/?pair=${code}` : wsUrl;
}

export async function showPairing(wsUrl: string, code?: string): Promise<void> {
  const mine = ++token;
  const url = pairUrl(wsUrl, code);
  const img = await QRCode.toDataURL(url, { margin: 1, width: 200 });
  if (mine !== token) return;
  const root = el();
  const pic = document.createElement("img");
  pic.src = img;
  pic.alt = "QR";
  const title = document.createElement("div");
  title.textContent = "Telefonla okut";
  const addr = document.createElement("code");
  addr.textContent = code ? `${wsUrl.replace(/^wss?:\/\//, "")} · ${code}` : wsUrl;
  root.replaceChildren(pic, title, addr);
  root.style.display = "flex";
}

export function hidePairing(): void {
  token++;
  el().style.display = "none";
}
