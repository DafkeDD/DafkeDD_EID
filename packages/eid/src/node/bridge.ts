/**
 * De bridge: een kleine HTTP-server op 127.0.0.1 die de kaart aanbiedt aan toegelaten websites.
 *
 * Beveiliging (zie docs/beveiliging.md):
 * - luistert alleen op loopback;
 * - Host-header moet 127.0.0.1/localhost/[::1] met onze poort zijn (tegen DNS-rebinding);
 * - Origin moet in de allowlist staan; anders 403 zonder CORS-headers (de site kan niets lezen);
 * - zonder Origin: alleen als de browser zegt dat het geen cross-site verzoek is (Sec-Fetch-Site);
 * - optioneel token;
 * - Cache-Control: no-store, niets loggen behalve methode/pad/status, cache gewist bij kaart eruit.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  assertOriginPattern,
  DEFAULT_BRIDGE_PORT,
  DEFAULT_ORIGINS,
  EidError,
  encodeCardData,
  matchOrigin,
  PROTOCOL_VERSION,
  TOKEN_HEADER,
  toHex,
  type BridgeErrorBody,
  type BridgeEvent,
  type BridgeStatus,
  type CardResponse,
  type EidCardData,
  type EidErrorCode,
} from "../core";
import { VERSION } from "../version";
import type { EidReader } from "./reader";
import type { ReaderEvent } from "./monitor";

export interface BridgeOptions {
  reader: EidReader;
  /** Standaard 47820. 0 = willekeurige vrije poort (tests). */
  port?: number;
  /** Alleen loopback: "127.0.0.1" (standaard) of "::1". */
  host?: "127.0.0.1" | "::1";
  /** Toegelaten websites (patronen, zie matchOrigin). Standaard alleen localhost. */
  origins?: readonly string[];
  /** Optioneel geheim dat elke aanvraag moet meesturen. */
  token?: string;
  /** Wordt opgeroepen na elke aanvraag. Bevat nooit querystring of gegevens. */
  onRequest?: (info: { method: string; path: string; status: number; ms: number }) => void;
  /** Interval van de SSE-heartbeat. Standaard 15 s. */
  heartbeatMs?: number;
}

export interface Bridge {
  readonly port: number;
  readonly url: string;
  readonly origins: readonly string[];
  close(): Promise<void>;
}

const STATUS_BY_CODE: Partial<Record<EidErrorCode, number>> = {
  "no-reader": 409,
  "no-card": 409,
  "not-eid": 409,
  "card-removed": 409,
  "card-busy": 409,
  aborted: 409,
  unauthorized: 401,
  "origin-not-allowed": 403,
  "auth-not-allowed": 403,
  "not-found": 404,
  timeout: 504,
  "read-failed": 502,
  "invalid-data": 502,
};

const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
} as const;

function sha256(text: string): Buffer {
  return createHash("sha256").update(text, "utf8").digest();
}

function toBridgeEvent(event: ReaderEvent): BridgeEvent {
  return event.type === "card-inserted" ? { type: event.type, reader: event.reader, atr: toHex(event.atr) } : event;
}

export async function startBridge(options: BridgeOptions): Promise<Bridge> {
  const { reader, token, onRequest } = options;
  const host = options.host ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "::1") throw new EidError("internal", `De bridge luistert alleen op loopback, niet op ${String(host)}`);
  const origins = [...(options.origins ?? DEFAULT_ORIGINS)];
  origins.forEach(assertOriginPattern);
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  const tokenHash = token ? sha256(token) : undefined;

  let port = options.port ?? DEFAULT_BRIDGE_PORT;
  const streams = new Set<ServerResponse>();
  /** Uitgelezen kaarten per lezer, tot de kaart eruit gaat. */
  const cache = new Map<string, Promise<EidCardData>>();

  const unsubscribe = reader.on((event) => {
    if (event.type === "card-removed" || event.type === "reader-removed" || event.type === "card-inserted") cache.delete(event.reader);
    const data = JSON.stringify(toBridgeEvent(event));
    for (const stream of streams) stream.write(`event: ${event.type}\ndata: ${data}\n\n`);
  });

  const status = (): BridgeStatus => ({ name: "dafke-eid", version: VERSION, protocol: PROTOCOL_VERSION, readers: reader.readers() });

  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);

  function tokenOk(req: IncomingMessage, url: URL): boolean {
    if (!tokenHash) return true;
    const auth = req.headers.authorization;
    const header = req.headers[TOKEN_HEADER];
    const given =
      (auth?.startsWith("Bearer ") ? auth.slice(7) : undefined) ??
      (typeof header === "string" ? header : undefined) ??
      // EventSource kan geen headers zetten: alleen daar mag het token in de URL.
      (url.pathname === "/v1/events" ? (url.searchParams.get("token") ?? undefined) : undefined);
    return given !== undefined && timingSafeEqual(sha256(given), tokenHash);
  }

  async function readCard(name: string): Promise<EidCardData> {
    let pending = cache.get(name);
    if (!pending) {
      pending = reader.read(name);
      cache.set(name, pending);
      pending.catch(() => {
        if (cache.get(name) === pending) cache.delete(name);
      });
    }
    return pending;
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<number> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const origin = req.headers.origin;
    const cors: Record<string, string> = {};

    const send = (code: number, body: unknown, extra: Record<string, string> = {}) => {
      res.writeHead(code, { ...BASE_HEADERS, ...cors, ...extra, "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(body));
      return code;
    };
    const fail = (error: unknown) => {
      const eid = EidError.is(error) ? error : new EidError("internal", "Onverwachte fout");
      const body: BridgeErrorBody = { error: { code: eid.code, message: eid.message } };
      return send(STATUS_BY_CODE[eid.code] ?? 500, body);
    };

    // 1. Host (DNS-rebinding)
    if (!allowedHosts().has((req.headers.host ?? "").toLowerCase())) {
      return fail(new EidError("unauthorized", "Ongeldige Host-header"));
    }

    // 2. Origin
    if (origin !== undefined) {
      if (!matchOrigin(origin, origins)) return fail(new EidError("origin-not-allowed", "Deze website mag de eID-lezer niet gebruiken"));
      cors["Access-Control-Allow-Origin"] = origin;
      cors["Vary"] = "Origin";
    } else {
      const site = req.headers["sec-fetch-site"];
      if (site !== undefined && site !== "none" && site !== "same-origin") {
        return fail(new EidError("origin-not-allowed", "Cross-site verzoek zonder Origin"));
      }
    }

    // 3. Preflight (CORS + Private Network Access)
    if (req.method === "OPTIONS") {
      const headers: Record<string, string> = {
        ...BASE_HEADERS,
        ...cors,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": `authorization, content-type, ${TOKEN_HEADER}`,
        "Access-Control-Max-Age": "600",
      };
      if (req.headers["access-control-request-private-network"] === "true") headers["Access-Control-Allow-Private-Network"] = "true";
      res.writeHead(204, headers);
      res.end();
      return 204;
    }

    // 4. Token
    if (!tokenOk(req, url)) return fail(new EidError("unauthorized", "Token ontbreekt of klopt niet"));

    if (req.method !== "GET") return fail(new EidError("not-found", `Methode ${req.method} niet ondersteund`));

    // 5. Routes
    try {
      switch (url.pathname) {
        case "/v1/status":
          return send(200, status());
        case "/v1/readers":
          return send(200, { readers: reader.readers() });
        case "/v1/card": {
          const name = reader.resolveReader(url.searchParams.get("reader") ?? undefined);
          const data = await readCard(name);
          const withPhoto = !["0", "false"].includes(url.searchParams.get("photo") ?? "");
          const { photo, ...rest } = data;
          const body: CardResponse = { reader: name, card: encodeCardData(withPhoto && photo ? { ...rest, photo } : rest) };
          return send(200, body);
        }
        case "/v1/events": {
          res.writeHead(200, { ...BASE_HEADERS, ...cors, "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive" });
          res.write(`retry: 2000\n\nevent: status\ndata: ${JSON.stringify(status())}\n\n`);
          streams.add(res);
          const heartbeat = setInterval(() => res.write(": ping\n\n"), heartbeatMs);
          req.on("close", () => {
            clearInterval(heartbeat);
            streams.delete(res);
          });
          return 200;
        }
        default:
          return fail(new EidError("not-found", `Onbekend adres: ${url.pathname}`));
      }
    } catch (error) {
      return fail(error);
    }
  }

  const server: Server = createServer((req, res) => {
    const start = Date.now();
    const path = (req.url ?? "/").split("?")[0]!;
    handle(req, res)
      .catch(() => {
        if (!res.headersSent) res.writeHead(500, BASE_HEADERS);
        res.end();
        return 500;
      })
      .then((code) => onRequest?.({ method: req.method ?? "?", path, status: code, ms: Date.now() - start }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      unsubscribe();
      reject(
        error.code === "EADDRINUSE"
          ? new EidError("internal", `Poort ${port} is al in gebruik. Draait dafke-eid al?`, { cause: error })
          : error,
      );
    });
    server.listen(port, host, () => resolve());
  });
  const address = server.address();
  if (address && typeof address === "object") port = address.port;

  return {
    port,
    url: `http://${host === "::1" ? "[::1]" : host}:${port}`,
    origins,
    async close() {
      unsubscribe();
      for (const stream of streams) stream.end();
      streams.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
