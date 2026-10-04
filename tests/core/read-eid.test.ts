import { describe, expect, it } from "vitest";
import { EidError, isEid, readEid, readFile, EID_FILES, verifyPhoto, toHex, digest } from "../../packages/eid/src/core";
import { createSampleCard, SAMPLE_PHOTO, VirtualCard } from "../../packages/eid/src/mock";

describe("readEid", () => {
  it("leest identiteit, adres, foto en kaartinfo van de voorbeeldkaart", async () => {
    const card = await createSampleCard();
    const data = await readEid(card);
    expect(data.identity.lastName).toBe("Specimen");
    expect(data.identity.nationalNumber).toBe("85031512369");
    expect(data.address).toMatchObject({ street: "Voorbeeldstraat", zipCode: "9000", municipality: "Gent" });
    expect(data.photo).toEqual({ mimeType: "image/jpeg", data: SAMPLE_PHOTO });
    expect(data.cardInfo).toEqual({ serialNumber: "534C494E33660013931D2C2E43D53A00", appletVersion: "1.8" });
    expect(data.certificates).toBeUndefined();
  });

  it("werkt met applet 1.7 (SHA-1 foto-hash)", async () => {
    const data = await readEid(await createSampleCard({ appletVersion: "1.7" }));
    expect(data.cardInfo?.appletVersion).toBe("1.7");
    expect(data.photo).toBeDefined();
  });

  it("werkt met T=0-gedrag (61xx) en kaarten die 6Cxx antwoorden", async () => {
    const card = await createSampleCard({ t0: true, strictLe: true });
    const data = await readEid(card);
    expect(data.identity.lastName).toBe("Specimen");
    expect(data.cardInfo?.appletVersion).toBe("1.8");
  });

  it("slaat de foto over met photo: false", async () => {
    const card = await createSampleCard();
    const data = await readEid(card, { photo: false });
    expect(data.photo).toBeUndefined();
    const photoSelect = "00a4080c04df014035";
    expect(card.commands.map((c) => toHex(c))).not.toContain(photoSelect);
  });

  it("laat cardInfo weg als de kaart GET CARD DATA niet kent", async () => {
    const data = await readEid(await createSampleCard({ cardData: null }));
    expect(data.cardInfo).toBeUndefined();
  });

  it("gooit invalid-data als de foto niet bij de hash past", async () => {
    const card = await createSampleCard({ photoHash: new Uint8Array(48) });
    await expect(readEid(card)).rejects.toMatchObject({ code: "invalid-data" });
    // Zonder controle lukt het wel.
    await expect(readEid(await createSampleCard({ photoHash: new Uint8Array(48) }), { verifyPhotoHash: false })).resolves.toBeDefined();
  });

  it("gooit not-eid voor een kaart zonder identiteitsbestand", async () => {
    const other = new VirtualCard({});
    await expect(isEid(other)).resolves.toBe(false);
    await expect(readEid(other)).rejects.toMatchObject({ code: "not-eid" });
  });

  it("geeft card-removed door als de kaart eruit gaat", async () => {
    const card = await createSampleCard();
    card.remove();
    await expect(readEid(card)).rejects.toMatchObject({ code: "card-removed" });
  });

  it("stopt met aborted via een AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(readEid(await createSampleCard(), { signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
  });

  it("leest certificaten op vraag; auth/sign mogen ontbreken", async () => {
    const der = (n: number) => new Uint8Array(400).fill(n);
    const card = await createSampleCard({ certificates: { ca: der(1), root: der(2), rrn: der(3) } });
    const data = await readEid(card, { certificates: true });
    expect(data.certificates).toEqual({ ca: der(1), root: der(2), rrn: der(3) });

    const full = await createSampleCard({
      certificates: { authentication: der(4), signing: der(5), ca: der(1), root: der(2), rrn: der(3) },
    });
    expect((await readEid(full, { certificates: true })).certificates?.authentication).toEqual(der(4));
  });

  it("geeft alle fouten als EidError", async () => {
    try {
      await readEid(new VirtualCard({}));
      expect.unreachable();
    } catch (error) {
      expect(EidError.is(error)).toBe(true);
    }
  });
});

describe("readFile", () => {
  it("leest bestanden die precies een veelvoud van de blokgrootte zijn", async () => {
    const data = new Uint8Array(480).map((_, i) => i & 0xff);
    const card = new VirtualCard({ photo: data });
    expect(await readFile(card, EID_FILES.photo)).toEqual(data);
  });

  it("leest een leeg bestand", async () => {
    expect(await readFile(new VirtualCard({ photo: new Uint8Array() }), EID_FILES.photo)).toEqual(new Uint8Array());
  });
});

describe("verifyPhoto", () => {
  it("controleert SHA-1, SHA-256 en SHA-384", async () => {
    for (const algorithm of ["SHA-1", "SHA-256", "SHA-384"] as const) {
      const hash = toHex(await digest(algorithm, SAMPLE_PHOTO));
      expect(await verifyPhoto(SAMPLE_PHOTO, hash), algorithm).toBe(true);
    }
    expect(await verifyPhoto(SAMPLE_PHOTO, "00".repeat(20))).toBe(false);
    expect(await verifyPhoto(SAMPLE_PHOTO, "")).toBe(false);
  });
});
