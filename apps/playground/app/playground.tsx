"use client";

import { useState } from "react";
import { MockEidClient } from "@dafkedd/eid/mock";
import {
  EidProvider,
  formatAddress,
  formatDate,
  formatNationalNumber,
  fullName,
  photoDataUrl,
  useEid,
  type EidPhase,
} from "@dafkedd/eid/react";

const PHASES: Record<EidPhase, { text: string; tone: "ok" | "warn" | "err" | "info" }> = {
  connecting: { text: "Verbinden met de eID-lezer…", tone: "info" },
  "no-bridge": { text: "De eID-lezer (dafke-eid) draait niet, of deze website is niet toegelaten.", tone: "err" },
  "bridge-outdated": { text: "De eID-lezer moet bijgewerkt worden.", tone: "warn" },
  "no-reader": { text: "Sluit een kaartlezer aan.", tone: "warn" },
  "no-card": { text: "Steek je eID in de lezer.", tone: "info" },
  ready: { text: "Kaart gevonden.", tone: "info" },
  reading: { text: "Bezig met lezen…", tone: "info" },
  done: { text: "Kaart gelezen.", tone: "ok" },
  error: { text: "Lezen mislukt.", tone: "err" },
};

function Status() {
  const eid = useEid();
  const phase = PHASES[eid.phase];
  return (
    <section className="panel" aria-live="polite">
      <div className="row">
        <span className="badge" data-tone={phase.tone} data-testid="phase" data-phase={eid.phase}>
          {eid.phase}
        </span>
        <span>{phase.text}</span>
      </div>
      {eid.error && (
        <p className="muted">
          Fout <code>{eid.error.code}</code>: {eid.error.message}
        </p>
      )}
      <p className="muted">
        Bridge: {eid.bridge ? `dafke-eid ${eid.bridge.version} (protocol ${eid.bridge.protocol})` : "—"} · Lezers:{" "}
        {eid.readers.length === 0 ? "geen" : eid.readers.map((r) => `${r.name}${r.cardPresent ? " [kaart]" : ""}`).join(", ")}
      </p>
      <div className="row">
        <button onClick={() => void eid.read()} disabled={eid.phase === "reading"}>
          Opnieuw lezen
        </button>
        <button onClick={() => eid.clear()}>Wissen</button>
      </div>
    </section>
  );
}

function CardView() {
  const { card } = useEid();
  if (!card) return null;
  const { identity: id, address, cardInfo } = card;
  const photo = photoDataUrl(card.photo);
  return (
    <section className="panel card" data-testid="card">
      {photo ? <img src={photo} alt={`Pasfoto van ${fullName(id)}`} /> : <div />}
      <dl>
        <dt>Naam</dt>
        <dd data-testid="name">{fullName(id)}</dd>
        <dt>Rijksregisternr.</dt>
        <dd>{formatNationalNumber(id.nationalNumber)}</dd>
        <dt>Geboren</dt>
        <dd>
          {formatDate(id.dateOfBirth) || id.dateOfBirthRaw} in {id.placeOfBirth}
        </dd>
        <dt>Adres</dt>
        <dd>{formatAddress(address)}</dd>
        <dt>Kaartnummer</dt>
        <dd>{id.cardNumber}</dd>
        <dt>Geldig</dt>
        <dd>
          {formatDate(id.validFrom)} tot {formatDate(id.validUntil)}
        </dd>
        {cardInfo && (
          <>
            <dt>Applet</dt>
            <dd>{cardInfo.appletVersion}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

function MockControls({ client }: { client: MockEidClient }) {
  const [bridge, setBridge] = useState(true);
  return (
    <section className="panel">
      <p className="muted">Virtuele lezer (zonder dafke-eid):</p>
      <div className="row">
        <button onClick={() => void client.insertCard()}>Kaart insteken</button>
        <button onClick={() => client.removeCard()}>Kaart uittrekken</button>
        <button
          onClick={() => {
            client.setBridgeAvailable(!bridge);
            setBridge(!bridge);
          }}
        >
          Bridge {bridge ? "uit" : "aan"}
        </button>
      </div>
    </section>
  );
}

export function Playground({ mock }: { mock: boolean }) {
  const [client] = useState(() => (mock ? new MockEidClient() : undefined));
  return (
    <main>
      <h1>DafkeDD EID</h1>
      <p className="muted">
        {mock ? (
          <>Virtuele kaart. <a href="/">Echte lezer gebruiken</a></>
        ) : (
          <>
            Start de bridge met <code>npm run bridge</code> (of <code>npm run bridge:mock</code>).{" "}
            <a href="/?mock=1">Zonder bridge proberen</a>
          </>
        )}
      </p>
      <EidProvider {...(client ? { client } : {})}>
        <Status />
        <CardView />
      </EidProvider>
      {client && <MockControls client={client} />}
    </main>
  );
}
