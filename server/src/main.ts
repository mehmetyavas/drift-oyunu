import path from "node:path";
import { fileURLToPath } from "node:url";
import { SERVER_PORT } from "@drift/shared";
import { createServer } from "./relay";
import { getLanIp } from "./lanIp";

const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = process.env.STATIC_DIR ?? path.resolve(here, "../../game/dist");
const port = Number(process.env.PORT) || SERVER_PORT;
const srv = await createServer({ port, staticDir });
console.log(`Oyun: http://${getLanIp()}:${srv.port}`);

const stop = () => srv.close().then(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
