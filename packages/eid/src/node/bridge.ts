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
 *
 * Testpagina (standaard aan, `testpage: false` = uit): `/`, `/testpage.css`, `/testpage.js` en de
 * endpoints onder `/v1/test/…`. Die laatste antwoorden alleen aan de eigen pagina (zelfde origin).
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
  checkNonce,
  isValidPin,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
  type AuthenticateResponse,
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
import { diagnoseReader } from "./diagnose-reader";
import { Logbook } from "./logbook";
import { TESTPAGE_CSP, TESTPAGE_CSS, TESTPAGE_HTML, TESTPAGE_JS } from "./testpage";

export interface BridgeOptions {
  reader: EidReader;
  /** Standaard 47820. 0 = willekeurige vrije poort (tests). */
  port?: number;
  /** Alleen loopback: "127.0.0.1" (standaard) of "::1". */
  host?: "127.0.0.1" | "::1";
  /** Toegelaten websites (patronen, zie matchOrigin). Standaard alleen localhost. */
  origins?: readonly string[];
  /**
   * Websites die mogen AANMELDEN met PIN (POST /v1/authenticate). Aparte lijst, standaard leeg.
   * Een website die alleen hierin staat, kan de kaart niet uitlezen (alleen status en aanmelden).
   */
  authOrigins?: readonly string[];
  /** Optioneel geheim dat elke aanvraag moet meesturen. */
  token?: string;
  /** Wordt opgeroepen na elke aanvraag. Bevat nooit querystring of gegevens. */
  onRequest?: (info: { method: string; path: string; status: number; ms: number }) => void;
  /** Interval van de SSE-heartbeat. Standaard 15 s. */
  heartbeatMs?: number;
  /** Ingebouwde testpagina op `/`. Standaard `true`. */
  testpage?: boolean;
  /** Logboek (geheugen + optioneel bestand). Standaard een logboek alleen in het geheugen. */
  logbook?: Logbook;
}

export interface Bridge {
  readonly port: number;
  readonly url: string;
  readonly origins: readonly string[];
  readonly authOrigins: readonly string[];
  readonly logbook: Logbook;
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
  "bad-request": 400,
  "pin-incorrect": 409,
  "pin-blocked": 409,
  "pin-cancelled": 409,
  "unsupported-card": 409,
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

const MAX_BODY_BYTES = 4096;

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new EidError("bad-request", "Aanvraag te groot");
    chunks.push(chunk as Buffer);
  }
  let json: unknown;
  try {
    json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new EidError("bad-request", "Geen geldige JSON");
  } finally {
    for (const chunk of chunks) chunk.fill(0); // bevat de PIN
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) throw new EidError("bad-request", "Verwacht een JSON-object");
  return json as Record<string, unknown>;
}

export async function startBridge(options: BridgeOptions): Promise<Bridge> {
  const { reader, token, onRequest } = options;
  const host = options.host ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "::1") throw new EidError("internal", `De bridge luistert alleen op loopback, niet op ${String(host)}`);
  const origins = [...(options.origins ?? DEFAULT_ORIGINS)];
  origins.forEach(assertOriginPattern);
  const authOrigins = [...(options.authOrigins ?? [])];
  authOrigins.forEach(assertOriginPattern);
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  const testpage = options.testpage ?? true;
  const logbook = options.logbook ?? new Logbook();
  const tokenHash = token ? sha256(token) : undefined;

  let port = options.port ?? DEFAULT_BRIDGE_PORT;
  const streams = new Set<ServerResponse>();
  /** Uitgelezen kaarten per lezer, tot de kaart eruit gaat. */
  const cache = new Map<string, Promise<EidCardData>>();

  const unsubscribe = reader.on((event) => {
    logbook.info(
      event.type === "card-inserted"
        ? `Kaart ingestoken in "${event.reader}"`
        : event.type === "card-removed"
          ? `Kaart verwijderd uit "${event.reader}"`
          : event.type === "reader-added"
            ? `Kaartlezer aangesloten: "${event.reader}"`
            : `Kaartlezer verwijderd: "${event.reader}"`,
    );
    if (event.type === "card-removed" || event.type === "reader-removed" || event.type === "card-inserted") cache.delete(event.reader);
    const data = JSON.stringify(toBridgeEvent(event));
    for (const stream of streams) stream.write(`event: ${event.type}\ndata: ${data}\n\n`);
  });

  const status = (): BridgeStatus => ({ name: "dafke-eid", version: VERSION, protocol: PROTOCOL_VERSION, readers: reader.readers() });

  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const ownOrigins = () => new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`]);

  /** Aanvraag van de eigen testpagina (zelfde origin)? */
  function fromOwnPage(req: IncomingMessage): boolean {
    if (!testpage) return false;
    const origin = req.headers.origin;
    if (origin !== undefined) return ownOrigins().has(origin.toLowerCase());
    return req.headers["sec-fetch-site"] === "same-origin";
  }

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
    const own = fromOwnPage(req);

    const send = (code: number, body: unknown, extra: Record<string, string> = {}) => {
      res.writeHead(code, { ...BASE_HEADERS, ...cors, ...extra, "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(body));
      return code;
    };
    const fail = (error: unknown) => {
      const eid = EidError.is(error) ? error : new EidError("internal", "Onverwachte fout");
      const body: BridgeErrorBody = {
        error: { code: eid.code, message: eid.message, ...(eid.triesLeft !== undefined ? { triesLeft: eid.triesLeft } : {}) },
      };
      return send(STATUS_BY_CODE[eid.code] ?? 500, body);
    };

    // 1. Host (DNS-rebinding)
    if (!allowedHosts().has((req.headers.host ?? "").toLowerCase())) {
      return fail(new EidError("unauthorized", "Ongeldige Host-header"));
    }

    // 2. Origin (lezen: origins; aanmelden: authOrigins)
    let authOnly = false;
    if (origin !== undefined && !own) {
      const readAllowed = matchOrigin(origin, origins);
      authOnly = !readAllowed && matchOrigin(origin, authOrigins);
      if (!readAllowed && !authOnly) {
        logbook.warn(`Geweigerd: ${origin} staat niet in de lijst van toegelaten websites (${req.method} ${url.pathname})`);
        return fail(new EidError("origin-not-allowed", "Deze website mag de eID-lezer niet gebruiken"));
      }
      cors["Access-Control-Allow-Origin"] = origin;
      cors["Vary"] = "Origin";
    } else if (origin === undefined) {
      const site = req.headers["sec-fetch-site"];
      if (site !== undefined && site !== "none" && site !== "same-origin") {
        logbook.warn(`Geweigerd: cross-site verzoek zonder Origin (${req.method} ${url.pathname})`);
        return fail(new EidError("origin-not-allowed", "Cross-site verzoek zonder Origin"));
      }
    }

    // 3. Preflight (CORS + Private Network Access)
    if (req.method === "OPTIONS") {
      const headers: Record<string, string> = {
        ...BASE_HEADERS,
        ...cors,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": `authorization, content-type, ${TOKEN_HEADER}`,
        "Access-Control-Max-Age": "600",
      };
      if (req.headers["access-control-request-private-network"] === "true") headers["Access-Control-Allow-Private-Network"] = "true";
      res.writeHead(204, headers);
      res.end();
      return 204;
    }

    const isAuthenticate = url.pathname === "/v1/authenticate";
    if (isAuthenticate ? req.method !== "POST" : req.method !== "GET") {
      return fail(new EidError("not-found", `Methode ${req.method} niet ondersteund voor ${url.pathname}`));
    }

    // Browsers vragen dit vanzelf; geen fout in het logboek.
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204, BASE_HEADERS);
      res.end();
      return 204;
    }

    // Testpagina en haar bestanden (geen persoonsgegevens; navigeren stuurt geen Origin).
    if (url.pathname === "/" || url.pathname === "/testpage.css" || url.pathname === "/testpage.js") {
      if (!testpage) return fail(new EidError("not-found", "De testpagina staat uit"));
      const [body, type] =
        url.pathname === "/"
          ? [TESTPAGE_HTML, "text/html; charset=utf-8"]
          : url.pathname === "/testpage.css"
            ? [TESTPAGE_CSS, "text/css; charset=utf-8"]
            : [TESTPAGE_JS, "text/javascript; charset=utf-8"];
      res.writeHead(200, { ...BASE_HEADERS, "Content-Type": type, "Content-Security-Policy": TESTPAGE_CSP, "X-Frame-Options": "DENY" });
      res.end(body);
      return 200;
    }

    // Endpoints van de testpagina: alleen voor de eigen pagina, zonder token (geen persoonsgegevens).
    if (url.pathname.startsWith("/v1/test/")) {
      if (!testpage) return fail(new EidError("not-found", "De testpagina staat uit"));
      if (!own && (origin !== undefined || req.headers["sec-fetch-site"] !== undefined)) {
        return fail(new EidError("origin-not-allowed", "Alleen voor de testpagina"));
      }
      switch (url.pathname) {
        case "/v1/test/info":
          return send(200, {
            version: VERSION,
            protocol: PROTOCOL_VERSION,
            url: `http://127.0.0.1:${port}`,
            origins,
            authOrigins,
            tokenRequired: tokenHash !== undefined,
            platform: `${process.platform} ${process.arch}, Node ${process.version}`,
            ...(logbook.file ? { logFile: logbook.file } : {}),
          });
        case "/v1/test/log":
          return send(200, { entries: logbook.entries() });
        case "/v1/test/check-origin": {
          const candidate = (url.searchParams.get("origin") ?? "").trim().replace(/\/+$/, "");
          return send(200, {
            origin: candidate,
            allowed: matchOrigin(candidate, origins),
            authAllowed: matchOrigin(candidate, authOrigins),
            origins,
            authOrigins,
          });
        }
        case "/v1/test/diag": {
          const text = await diagnoseReader(reader, {
            url: `http://127.0.0.1:${port}`,
            origins,
            tokenRequired: tokenHash !== undefined,
            testpage,
            ...(logbook.file ? { logFile: logbook.file } : {}),
          });
          res.writeHead(200, { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
          res.end(text);
          return 200;
        }
        default:
          return fail(new EidError("not-found", `Onbekend adres: ${url.pathname}`));
      }
    }

    // 4. Token (de eigen testpagina hoeft het alleen voor de kaart zelf)
    const tokenExempt = own && url.pathname !== "/v1/card";
    if (!tokenExempt && !tokenOk(req, url)) {
      logbook.warn(`Geweigerd: token ontbreekt of klopt niet (${req.method} ${url.pathname}${origin ? ` van ${origin}` : ""})`);
      return fail(new EidError("unauthorized", "Token ontbreekt of klopt niet"));
    }

    // Een website die alleen mag aanmelden, krijgt geen kaartgegevens.
    if (authOnly && !["/v1/status", "/v1/readers", "/v1/events", "/v1/authenticate"].includes(url.pathname)) {
      logbook.warn(`Geweigerd: ${origin} mag alleen aanmelden, niet ${url.pathname}`);
      return fail(new EidError("origin-not-allowed", "Deze website mag alleen aanmelden"));
    }

    // 5. Routes
    try {
      switch (url.pathname) {
        case "/v1/status":
          return send(200, status());
        case "/v1/readers":
          return send(200, { readers: reader.readers() });
        case "/v1/authenticate": {
          // De ondertekende origin komt van de browser (Origin-header), nooit uit de body.
          if (!origin || !(own || matchOrigin(origin, authOrigins))) {
            logbook.warn(`Geweigerd: aanmelden door ${origin ?? "(geen origin)"} is niet toegelaten`);
            return fail(new EidError("auth-not-allowed", "Deze website mag niet aanmelden met de eID"));
          }
          if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
            return fail(new EidError("bad-request", "Verwacht Content-Type: application/json"));
          }
          const request = await readJson(req);
          const nonce = request.nonce;
          let pin: string | undefined = typeof request.pin === "string" ? request.pin : undefined;
          if (!pin || !isValidPin(pin)) return fail(new EidError("bad-request", `Een PIN heeft ${PIN_MIN_LENGTH} tot ${PIN_MAX_LENGTH} cijfers`));
          checkNonce(nonce);
          const name = reader.resolveReader(typeof request.reader === "string" ? request.reader : undefined);
          logbook.info(`Aanmelden gevraagd door ${origin} op "${name}"`);
          try {
            const token = await reader.authenticate(name, {
              origin: origin.toLowerCase(),
              nonce,
              // De PIN komt uit de pagina: één poging per aanvraag. Bij een verkeerde PIN krijgt de
              // pagina pin-incorrect met het aantal resterende pogingen en vraagt ze opnieuw.
              pin: async ({ retry, triesLeft }) => {
                if (retry) throw new EidError("pin-incorrect", `Verkeerde PIN, nog ${triesLeft ?? "?"} poging(en)`, triesLeft !== null ? { triesLeft } : {});
                const value = pin ?? null;
                pin = undefined;
                return value;
              },
            });
            logbook.info(`Aanmelden gelukt voor ${origin} (${token.algorithm})`);
            const body: AuthenticateResponse = { reader: name, token };
            return send(200, body);
          } catch (error) {
            const eid = EidError.is(error) ? error : undefined;
            logbook.warn(`Aanmelden mislukt voor ${origin}: ${eid ? eid.code + (eid.triesLeft !== undefined ? ` (nog ${eid.triesLeft})` : "") : "fout"}`);
            throw error;
          } finally {
            pin = undefined;
          }
        }
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
      .then((code) => {
        const ms = Date.now() - start;
        onRequest?.({ method: req.method ?? "?", path, status: code, ms });
        // Testpagina-bestanden en het logboek zelf niet loggen (ruis).
        if (["/v1/test/log", "/testpage.css", "/testpage.js", "/v1/events", "/favicon.ico"].includes(path)) return;
        const origin = req.headers.origin;
        logbook.add(code >= 500 ? "error" : code >= 400 ? "warn" : "info", `${req.method} ${path} → ${code} (${ms} ms)${origin ? ` van ${origin}` : ""}`);
      });
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
  logbook.info(
    `dafke-eid ${VERSION} gestart op http://127.0.0.1:${port}; toegelaten: ${origins.join(", ")}` +
      (authOrigins.length > 0 ? `; aanmelden: ${authOrigins.join(", ")}` : "") +
      (tokenHash ? "; token vereist" : ""),
  );

  return {
    port,
    url: `http://${host === "::1" ? "[::1]" : host}:${port}`,
    origins,
    authOrigins,
    logbook,
    async close() {
      logbook.info("dafke-eid gestopt");
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
