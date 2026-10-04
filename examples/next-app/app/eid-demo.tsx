"use client";
import { useState } from "react";
import { EidProvider, useEid, useEidLogin, fullName } from "@dafkedd/eid/react";

function Kaart() {
  const eid = useEid();
  if (eid.phase === "no-bridge") return <p>Start het eID-programma (dafke-eid).</p>;
  if (eid.phase === "no-card") return <p>Steek je eID in.</p>;
  if (eid.phase !== "done" || !eid.card) return <p>{eid.phase}…</p>;
  return <p>Welkom, {fullName(eid.card.identity)}</p>;
}

function Aanmelden() {
  const login = useEidLogin();
  const [pin, setPin] = useState("");
  const [wie, setWie] = useState<string | null>(null);

  async function aanmelden(event: React.FormEvent) {
    event.preventDefault();
    const { nonce } = await (await fetch("/api/eid")).json();
    const token = await login.login({ nonce, pin });
    setPin("");
    if (!token) return;
    const res = await fetch("/api/eid", { method: "POST", body: JSON.stringify(token) });
    const body = await res.json();
    setWie(res.ok ? `${body.firstNames} ${body.lastName}` : `geweigerd (${body.error})`);
  }

  return (
    <form onSubmit={aanmelden}>
      <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} />
      <button disabled={login.status === "signing"}>Aanmelden</button>
      {login.error && <p>{login.error.code}{login.triesLeft != null ? ` (nog ${login.triesLeft})` : ""}</p>}
      {wie && <p>Aangemeld: {wie}</p>}
    </form>
  );
}

export default function EidDemo() {
  return (
    <EidProvider>
      <Kaart />
      <Aanmelden />
    </EidProvider>
  );
}
