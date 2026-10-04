import { cookies } from "next/headers";
import { EidVerifyError } from "@dafkedd/eid/server";
import { eid } from "@/lib/eid";

// GET /api/eid → nieuwe nonce (ook in een httpOnly-cookie, zodat hij bij deze browser hoort)
export async function GET() {
  const { nonce } = await eid.createChallenge();
  (await cookies()).set("eid_nonce", nonce, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/api/eid",
    maxAge: 300,
  });
  return Response.json({ nonce });
}

// POST /api/eid (body = token van useEidLogin) → wie is aangemeld
export async function POST(request: Request) {
  const jar = await cookies();
  const nonce = jar.get("eid_nonce")?.value;
  jar.delete("eid_nonce");
  if (!nonce) return Response.json({ error: "nonce-invalid" }, { status: 401 });
  try {
    const who = await eid.verify(await request.json(), nonce);
    // Hier: sessie aanmaken. Stuur geen rijksregisternummer terug als de browser het niet nodig heeft.
    return Response.json({ firstNames: who.firstNames, lastName: who.lastName });
  } catch (error) {
    if (EidVerifyError.is(error)) return Response.json({ error: error.code }, { status: 401 });
    throw error;
  }
}
