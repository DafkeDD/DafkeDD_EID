/**
 * React-bindings: <EidProvider> maakt één store per boom, useEid() leest hem via
 * useSyncExternalStore (SSR-veilig: op de server is de fase altijd "connecting").
 * Headless: de zichtbare componenten komen uit de DafkeDD UI-registry.
 * ("use client" wordt bij het bouwen bovenaan dist/react.* gezet, zie tsup.config.ts.)
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { EidError, type EidAuthToken, type EidCardData } from "../core";
import { EidClient, type EidClientLike } from "./client";
import { EidStore, type EidState } from "./store";

const EidContext = createContext<EidStore | null>(null);

export interface EidProviderProps {
  children?: ReactNode;
  /** Eigen client (bv. MockEidClient). Anders een EidClient met `url` en `token`. */
  client?: EidClientLike;
  /** Adres van de bridge. Standaard http://127.0.0.1:47820. */
  url?: string;
  token?: string;
  /** Automatisch lezen bij het insteken. Standaard `true`. */
  autoRead?: boolean;
  /** Foto lezen. Standaard `true`. */
  photo?: boolean;
  /** Alleen deze lezer gebruiken. */
  reader?: string;
}

export function EidProvider({ children, client, url, token, autoRead, photo, reader }: EidProviderProps) {
  // Eén store per provider. Wijzigingen aan de opties na de eerste render worden genegeerd.
  const [store] = useState(
    () =>
      new EidStore({
        client: client ?? new EidClient({ ...(url ? { url } : {}), ...(token ? { token } : {}) }),
        ...(autoRead !== undefined ? { autoRead } : {}),
        ...(photo !== undefined ? { photo } : {}),
        ...(reader !== undefined ? { reader } : {}),
      }),
  );
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  return <EidContext.Provider value={store}>{children}</EidContext.Provider>;
}

export interface UseEidResult extends EidState {
  /** Leest de kaart (opnieuw). */
  read(): Promise<EidCardData | null>;
  /** Wist de gelezen gegevens. */
  clear(): void;
}

function useStore(hook: string): EidStore {
  const store = useContext(EidContext);
  if (!store) throw new Error(`${hook}() moet binnen een <EidProvider> gebruikt worden`);
  return store;
}

export function useEid(): UseEidResult {
  const store = useStore("useEid");
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return useMemo(() => ({ ...state, read: () => store.read(), clear: () => store.clear() }), [state, store]);
}

/** Headless render-prop: <EidReader>{(eid) => …}</EidReader>. */
export function EidReader({ children }: { children: (eid: UseEidResult) => ReactNode }) {
  return <>{children(useEid())}</>;
}

export interface EidLoginState {
  status: "idle" | "signing" | "done" | "error";
  token: EidAuthToken | null;
  error: EidError | null;
  /** Resterende PIN-pogingen na een verkeerde PIN (of null). */
  triesLeft: number | null;
}

export interface UseEidLoginResult extends EidLoginState {
  /** Meldt aan met de PIN. Geeft het token, of null bij een fout (zie `error`). */
  login(request: { nonce: string; pin: string; reader?: string }): Promise<EidAuthToken | null>;
  reset(): void;
}

const IDLE: EidLoginState = { status: "idle", token: null, error: null, triesLeft: null };

/**
 * Aanmelden met PIN. Je server maakt een nonce, de gebruiker typt de PIN in jouw dialoog, en het
 * token gaat naar je server om te controleren (@dafkedd/eid/server). De bridge moet je website in
 * `authOrigins` hebben staan.
 */
export function useEidLogin(): UseEidLoginResult {
  const store = useStore("useEidLogin");
  const [state, setState] = useState<EidLoginState>(IDLE);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => () => pending.current?.abort(), []);

  const login = useCallback(
    async ({ nonce, pin, reader }: { nonce: string; pin: string; reader?: string }) => {
      const client = store.client;
      if (!client.authenticate) {
        const error = new EidError("internal", "Deze client kan niet aanmelden");
        setState({ ...IDLE, status: "error", error });
        return null;
      }
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      setState((s) => ({ ...s, status: "signing", error: null }));
      const target = reader ?? store.getSnapshot().reader ?? undefined;
      try {
        const { token } = await client.authenticate({ nonce, pin, ...(target ? { reader: target } : {}), signal: controller.signal });
        if (controller.signal.aborted) return null;
        setState({ status: "done", token, error: null, triesLeft: null });
        return token;
      } catch (error) {
        if (controller.signal.aborted) return null;
        const eid = EidError.is(error) ? error : new EidError("internal", String(error));
        setState({ status: "error", token: null, error: eid, triesLeft: eid.triesLeft ?? null });
        return null;
      }
    },
    [store],
  );

  const reset = useCallback(() => {
    pending.current?.abort();
    setState(IDLE);
  }, []);

  return useMemo(() => ({ ...state, login, reset }), [state, login, reset]);
}
