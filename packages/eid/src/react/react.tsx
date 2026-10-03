/**
 * React-bindings: <EidProvider> maakt één store per boom, useEid() leest hem via
 * useSyncExternalStore (SSR-veilig: op de server is de fase altijd "connecting").
 * Headless: de zichtbare componenten komen uit de DafkeDD UI-registry.
 * ("use client" wordt bij het bouwen bovenaan dist/react.* gezet, zie tsup.config.ts.)
 */

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { EidCardData } from "../core";
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

export function useEid(): UseEidResult {
  const store = useContext(EidContext);
  if (!store) throw new Error("useEid() moet binnen een <EidProvider> gebruikt worden");
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return useMemo(() => ({ ...state, read: () => store.read(), clear: () => store.clear() }), [state, store]);
}

/** Headless render-prop: <EidReader>{(eid) => …}</EidReader>. */
export function EidReader({ children }: { children: (eid: UseEidResult) => ReactNode }) {
  return <>{children(useEid())}</>;
}
