/**
 * Ingebouwde testpagina van de bridge (http://127.0.0.1:47820/). Eén HTML-bestand, één CSS en
 * één script, zonder externe bronnen (strikte CSP). Persoonsgegevens worden alleen in de browser
 * getoond, standaard gemaskeerd, en nooit gelogd.
 */

export const TESTPAGE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
  "frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export const TESTPAGE_HTML = String.raw`<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>DafkeDD eID — testpagina</title>
<link rel="stylesheet" href="/testpage.css">
</head>
<body>
<main>
  <header>
    <h1>DafkeDD eID</h1>
    <p class="muted" id="version">Testpagina van de eID-lezer op deze computer.</p>
  </header>

  <section class="panel" aria-labelledby="h-status">
    <h2 id="h-status">Status</h2>
    <dl id="status"><dt>Verbinding</dt><dd id="conn">Verbinden…</dd></dl>
  </section>

  <section class="panel" aria-labelledby="h-readers">
    <h2 id="h-readers">Kaartlezers</h2>
    <ul id="readers" class="list"><li class="muted">Laden…</li></ul>
  </section>

  <section class="panel" aria-labelledby="h-read">
    <h2 id="h-read">Test lezen</h2>
    <p class="muted">Leest de kaart en toont de gegevens hier, in deze browser. Er wordt niets opgeslagen of gelogd.</p>
    <div class="row" id="token-row" hidden>
      <label for="token">Token</label>
      <input id="token" type="password" autocomplete="off">
    </div>
    <div class="row">
      <button id="read" type="button">Test lezen</button>
      <label class="check"><input id="full" type="checkbox"> Toon alles</label>
    </div>
    <p id="read-status" class="muted" aria-live="polite"></p>
    <div id="card" class="card" hidden>
      <img id="photo" alt="Pasfoto" hidden>
      <dl id="card-data"></dl>
    </div>
  </section>

  <section class="panel" aria-labelledby="h-auth">
    <h2 id="h-auth">Test aanmelden</h2>
    <p class="muted">Controleert je PIN en laat de kaart een test-uitdaging ondertekenen. De PIN wordt niet bewaard of gelogd. Let op: na 3 verkeerde pogingen is je PIN geblokkeerd.</p>
    <div class="row">
      <label for="pin">PIN</label>
      <input id="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="12" pattern="[0-9]*">
      <button id="auth" type="button">Test aanmelden</button>
    </div>
    <p id="auth-status" aria-live="polite"></p>
    <dl id="auth-data" hidden></dl>
  </section>

  <section class="panel" aria-labelledby="h-origin">
    <h2 id="h-origin">Website testen</h2>
    <p class="muted">Mag deze website de eID-lezer gebruiken?</p>
    <div class="row">
      <input id="origin" type="url" placeholder="https://app.voorbeeld.be" aria-label="Adres van de website">
      <button id="check" type="button">Controleren</button>
    </div>
    <p id="origin-result" aria-live="polite"></p>
  </section>

  <section class="panel" aria-labelledby="h-diag">
    <h2 id="h-diag">Diagnose</h2>
    <p class="muted">Technische gegevens zonder persoonsgegevens, om door te sturen naar support.</p>
    <div class="row">
      <button id="diag" type="button">Diagnose maken</button>
      <button id="copy" type="button" disabled>Kopieer voor support</button>
    </div>
    <pre id="diag-output" hidden></pre>
  </section>

  <section class="panel" aria-labelledby="h-log">
    <h2 id="h-log">Logboek</h2>
    <p class="muted" id="log-file"></p>
    <ol id="log" class="log"></ol>
  </section>
</main>
<script src="/testpage.js"></script>
</body>
</html>
`;

export const TESTPAGE_CSS = String.raw`:root {
  --bg: #f6f7f9; --fg: #1d2330; --muted: #5b6475; --card: #ffffff; --border: #dde1e8;
  --accent: #2f5bd3; --ok: #1f7a4d; --warn: #9a5b00; --err: #b42318;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #12151b; --fg: #e8ebf1; --muted: #9aa3b5; --card: #1a1f27; --border: #2c3340;
    --accent: #7c9cf0; --ok: #5cc28e; --warn: #e0a84a; --err: #f07167; }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 820px; margin: 0 auto; padding: 24px 16px 48px; display: grid; gap: 16px; }
h1 { font-size: 22px; margin: 0; }
h2 { font-size: 16px; margin: 0 0 8px; }
.muted { color: var(--muted); margin: 4px 0; }
.panel { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 16px; min-width: 0; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 8px 0; }
button, input { font: inherit; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--card); color: var(--fg); }
button { cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--accent); }
button:disabled { opacity: .5; cursor: default; }
input[type=url] { flex: 1 1 240px; min-width: 0; }
.check { display: inline-flex; gap: 6px; align-items: center; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; }
dt { color: var(--muted); }
dd { margin: 0; overflow-wrap: anywhere; }
.list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.badge { display: inline-block; padding: 1px 8px; border-radius: 999px; border: 1px solid currentColor; font-size: 12px; margin-right: 6px; }
.ok { color: var(--ok); } .warn { color: var(--warn); } .err { color: var(--err); }
.card { display: flex; gap: 16px; margin-top: 8px; align-items: flex-start; }
.card img { width: 120px; flex: none; border-radius: 8px; border: 1px solid var(--border); }
.card dl { flex: 1; min-width: 0; }
pre { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px; overflow-x: auto; font-size: 13px; }
.log { list-style: none; margin: 0; padding: 0; font: 13px/1.4 ui-monospace, monospace; max-height: 320px; overflow-y: auto; }
.log li { padding: 2px 0; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
code { font-size: 13px; overflow-wrap: anywhere; }
@media (max-width: 520px) { .card { flex-direction: column; } dl { grid-template-columns: 1fr; } dt { margin-top: 6px; } }
`;

/** Gewoon script (geen modules, geen template literals), zodat het overal zonder build werkt. */
export const TESTPAGE_JS = String.raw`(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var info = null;

  function text(el, value) { el.textContent = value == null ? "" : String(value); }
  function el(tag, cls, value) { var e = document.createElement(tag); if (cls) e.className = cls; if (value != null) e.textContent = value; return e; }

  function maskWord(word) {
    return String(word || "").split(/(\s+|-)/).map(function (part) {
      return /^\s+$|^-$/.test(part) || part.length === 0 ? part : part[0] + "*".repeat(part.length - 1);
    }).join("");
  }

  function getJson(path, headers) {
    return fetch(path, { cache: "no-store", headers: headers || {} }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (body) {
        if (!res.ok) {
          var err = body && body.error ? body.error : { code: "internal", message: "HTTP " + res.status };
          throw err;
        }
        return body;
      });
    });
  }

  // --- status en info ---
  function loadInfo() {
    return getJson("/v1/test/info").then(function (data) {
      info = data;
      text($("version"), "dafke-eid " + data.version + " — " + data.url);
      $("token-row").hidden = !data.tokenRequired;
      var dl = $("status");
      dl.textContent = "";
      var rows = [
        ["Verbinding", "verbonden"],
        ["Versie", data.version + " (protocol " + data.protocol + ")"],
        ["Adres", data.url],
        ["Toegelaten websites", data.origins.join(", ")],
        ["Aanmelden met PIN", data.authOrigins.length ? data.authOrigins.join(", ") : "geen enkele website"],
        ["Token vereist", data.tokenRequired ? "ja" : "nee"],
        ["Platform", data.platform],
      ];
      if (data.logFile) rows.push(["Logbestand", data.logFile]);
      rows.forEach(function (r) { dl.appendChild(el("dt", null, r[0])); dl.appendChild(el("dd", null, r[1])); });
      text($("log-file"), data.logFile ? "Ook bewaard in " + data.logFile : "Laatste gebeurtenissen (alleen in het geheugen).");
    }).catch(function () { text($("conn"), "niet verbonden"); });
  }

  // --- lezers live ---
  var readers = [];
  function renderReaders() {
    var ul = $("readers");
    ul.textContent = "";
    if (readers.length === 0) { ul.appendChild(el("li", "muted", "Geen kaartlezer gevonden. Sluit er een aan.")); return; }
    readers.forEach(function (r) {
      var li = el("li");
      li.appendChild(el("span", "badge " + (r.cardPresent ? "ok" : "warn"), r.cardPresent ? "kaart" : "leeg"));
      li.appendChild(el("span", null, r.name));
      if (r.atr) { li.appendChild(document.createTextNode(" ")); li.appendChild(el("code", "muted", "ATR " + r.atr)); }
      ul.appendChild(li);
    });
  }
  function connectEvents() {
    var source = new EventSource("/v1/events");
    source.addEventListener("status", function (e) { readers = JSON.parse(e.data).readers; renderReaders(); });
    function update(e) {
      var ev = JSON.parse(e.data);
      if (ev.type === "reader-added" && !readers.some(function (r) { return r.name === ev.reader; })) readers.push({ name: ev.reader, cardPresent: false });
      if (ev.type === "reader-removed") readers = readers.filter(function (r) { return r.name !== ev.reader; });
      readers = readers.map(function (r) {
        if (r.name !== ev.reader) return r;
        if (ev.type === "card-inserted") return { name: r.name, cardPresent: true, atr: ev.atr };
        if (ev.type === "card-removed") return { name: r.name, cardPresent: false };
        return r;
      });
      if (ev.type === "card-removed") { $("card").hidden = true; text($("read-status"), "Kaart verwijderd."); lastCard = null; }
      renderReaders();
      loadLog();
    }
    ["reader-added", "reader-removed", "card-inserted", "card-removed"].forEach(function (t) { source.addEventListener(t, update); });
    source.onerror = function () { text($("conn"), "verbinding verbroken, opnieuw proberen…"); };
  }

  // --- test lezen ---
  var lastCard = null;
  function row(dl, label, value) { dl.appendChild(el("dt", null, label)); dl.appendChild(el("dd", null, value)); }
  function renderCard() {
    if (!lastCard) return;
    var full = $("full").checked;
    var c = lastCard.card, id = c.identity, a = c.address;
    var dl = $("card-data");
    dl.textContent = "";
    row(dl, "Kaartlezer", lastCard.reader);
    if (full) {
      row(dl, "Naam", id.firstNames + " " + id.lastName);
      row(dl, "Rijksregisternr.", id.nationalNumber);
      row(dl, "Geboren", (id.dateOfBirthRaw || "") + " in " + id.placeOfBirth);
      row(dl, "Geslacht", id.gender);
      row(dl, "Nationaliteit", id.nationality);
      row(dl, "Adres", a.streetAndNumber + ", " + a.zipCode + " " + a.municipality);
      row(dl, "Kaartnummer", id.cardNumber);
    } else {
      row(dl, "Naam", maskWord(id.firstNames) + " " + maskWord(id.lastName));
      row(dl, "Rijksregisternr.", id.nationalNumber.slice(0, 6) + "-***-**");
      row(dl, "Geboortejaar", id.dateOfBirth ? id.dateOfBirth.year : "?");
      row(dl, "Adres", "***, " + a.zipCode + " " + a.municipality);
      row(dl, "Kaartnummer", "********" + id.cardNumber.slice(-4));
    }
    row(dl, "Geldig tot", id.validUntil);
    if (c.cardInfo) row(dl, "Applet", c.cardInfo.appletVersion);
    row(dl, "Foto", c.photo ? atob(c.photo.data).length + " bytes, hash klopt" : "niet gelezen");
    row(dl, "Leestijd", lastCard.ms + " ms");
    var img = $("photo");
    if (full && c.photo) { img.src = "data:" + c.photo.mimeType + ";base64," + c.photo.data; img.hidden = false; }
    else { img.removeAttribute("src"); img.hidden = true; }
    $("card").hidden = false;
  }
  $("full").addEventListener("change", renderCard);
  $("read").addEventListener("click", function () {
    var button = $("read");
    button.disabled = true;
    text($("read-status"), "Bezig met lezen…");
    var token = $("token").value;
    var start = performance.now();
    getJson("/v1/card", token ? { "x-dafke-eid-token": token } : {}).then(function (data) {
      lastCard = { reader: data.reader, card: data.card, ms: Math.round(performance.now() - start) };
      text($("read-status"), "Kaart gelezen.");
      renderCard();
    }).catch(function (err) {
      lastCard = null;
      $("card").hidden = true;
      text($("read-status"), "Mislukt (" + err.code + "): " + err.message);
    }).then(function () { button.disabled = false; loadLog(); });
  });

  // --- website testen ---
  $("check").addEventListener("click", function () {
    var origin = $("origin").value.trim().replace(/\/+$/, "");
    if (!origin) return;
    getJson("/v1/test/check-origin?origin=" + encodeURIComponent(origin)).then(function (data) {
      var p = $("origin-result");
      p.className = data.allowed ? "ok" : "err";
      var parts = [];
      parts.push(data.allowed ? "mag de kaart lezen" : "mag de kaart NIET lezen");
      parts.push(data.authAllowed ? "mag aanmelden met PIN" : "mag niet aanmelden");
      p.className = data.allowed || data.authAllowed ? "ok" : "err";
      text(p, origin + ": " + parts.join(", ") + ". Toegelaten om te lezen: " + data.origins.join(", ") + ".");
    }).catch(function (err) { text($("origin-result"), "Fout: " + err.message); });
  });

  // --- test aanmelden ---
  function derRead(b, o) {
    var tag = b[o], len = b[o + 1], off = o + 2;
    if (len & 0x80) { var n = len & 0x7f; len = 0; for (var i = 0; i < n; i++) len = len * 256 + b[off + i]; off += n; }
    return { tag: tag, start: o, content: off, end: off + len };
  }
  function derChildren(b, node) {
    var out = [], o = node.content;
    while (o < node.end) { var c = derRead(b, o); out.push(c); o = c.end; }
    return out;
  }
  function b64ToBytes(s) { var bin = atob(s), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  function bytesToB64(bytes) { var bin = ""; for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return btoa(bin); }
  function concat(a, b) { var out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; }

  /** Controleert de handtekening in de browser met WebCrypto, zoals een server dat zou doen (zonder keten). */
  function verifyToken(token, origin, nonce) {
    var cert = b64ToBytes(token.unverifiedCertificate);
    var tbs = derChildren(cert, derRead(cert, 0))[0];
    var fields = derChildren(cert, tbs);
    var spki = fields[(fields[0].tag === 0xa0 ? 1 : 0) + 5];
    var spkiBytes = cert.slice(spki.start, spki.end);
    var ec = token.algorithm.indexOf("ES") === 0;
    var hash = token.algorithm === "ES384" ? "SHA-384" : token.algorithm === "ES512" ? "SHA-512" : "SHA-256";
    var curve = token.algorithm === "ES384" ? "P-384" : token.algorithm === "ES512" ? "P-521" : "P-256";
    var importAlg = ec ? { name: "ECDSA", namedCurve: curve } : { name: "RSASSA-PKCS1-v1_5", hash: hash };
    var verifyAlg = ec ? { name: "ECDSA", hash: hash } : { name: "RSASSA-PKCS1-v1_5" };
    var enc = new TextEncoder();
    return Promise.all([
      crypto.subtle.importKey("spki", spkiBytes, importAlg, false, ["verify"]),
      crypto.subtle.digest(hash, enc.encode(origin)),
      crypto.subtle.digest(hash, enc.encode(nonce)),
    ]).then(function (r) {
      var signed = concat(new Uint8Array(r[1]), new Uint8Array(r[2]));
      return crypto.subtle.verify(verifyAlg, r[0], b64ToBytes(token.signature), signed);
    });
  }

  $("auth").addEventListener("click", function () {
    var pinInput = $("pin");
    var pin = pinInput.value;
    pinInput.value = "";
    var status = $("auth-status");
    var dl = $("auth-data");
    dl.hidden = true;
    status.className = "";
    if (!/^[0-9]{4,12}$/.test(pin)) { status.className = "err"; text(status, "Een PIN heeft 4 tot 12 cijfers."); return; }
    var nonceBytes = new Uint8Array(32);
    crypto.getRandomValues(nonceBytes);
    var nonce = bytesToB64(nonceBytes);
    var button = $("auth");
    button.disabled = true;
    text(status, "Bezig met aanmelden…");
    var token = $("token").value;
    var headers = { "content-type": "application/json" };
    if (token) headers["x-dafke-eid-token"] = token;
    fetch("/v1/authenticate", { method: "POST", cache: "no-store", headers: headers, body: JSON.stringify({ nonce: nonce, pin: pin }) })
      .then(function (res) { return res.json().then(function (body) { if (!res.ok) throw body.error; return body; }); })
      .then(function (data) {
        var t = data.token;
        dl.textContent = "";
        row(dl, "Kaartlezer", data.reader);
        row(dl, "Formaat", t.format);
        row(dl, "Algoritme", t.algorithm);
        row(dl, "Handtekening", b64ToBytes(t.signature).length + " bytes");
        row(dl, "Certificaat", b64ToBytes(t.unverifiedCertificate).length + " bytes");
        dl.hidden = false;
        text(status, "Aanmelden gelukt. Handtekening controleren…");
        return verifyToken(t, location.origin, nonce).then(function (ok) {
          status.className = ok ? "ok" : "err";
          text(status, ok ? "Aanmelden gelukt — de handtekening klopt." : "Aanmelden gelukt, maar de handtekening klopt NIET.");
        });
      })
      .catch(function (err) {
        status.className = "err";
        text(status, "Mislukt (" + (err && err.code) + "): " + (err && err.message));
      })
      .then(function () { pin = ""; button.disabled = false; loadLog(); });
  });

  // --- diagnose ---
  $("diag").addEventListener("click", function () {
    var out = $("diag-output");
    out.hidden = false;
    text(out, "Bezig…");
    fetch("/v1/test/diag", { cache: "no-store" }).then(function (res) { return res.text(); }).then(function (t) {
      text(out, t);
      $("copy").disabled = false;
    });
  });
  $("copy").addEventListener("click", function () {
    var t = $("diag-output").textContent;
    navigator.clipboard.writeText(t).then(function () { text($("copy"), "Gekopieerd"); setTimeout(function () { text($("copy"), "Kopieer voor support"); }, 1500); });
  });

  // --- logboek ---
  function loadLog() {
    getJson("/v1/test/log").then(function (data) {
      var ol = $("log");
      ol.textContent = "";
      data.entries.slice().reverse().forEach(function (e) {
        var li = el("li", e.level === "error" ? "err" : e.level === "warn" ? "warn" : null, e.time.replace("T", " ").slice(0, 19) + "  " + e.message);
        ol.appendChild(li);
      });
    }).catch(function () {});
  }

  loadInfo();
  connectEvents();
  loadLog();
  setInterval(loadLog, 3000);
})();
`;
