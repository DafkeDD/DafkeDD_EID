// Zet de test-PKI om naar packages/eid/src/mock/test-pki.ts (browser-veilig: hex en base64, geen PEM-parsing).
import { createPrivateKey, X509Certificate } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const dir = "tests/fixtures/pki";
const der = (name) => new X509Certificate(readFileSync(`${dir}/${name}.pem`)).raw.toString("base64");
const jwk = (name) => createPrivateKey(readFileSync(`${dir}/${name}.key.pem`)).export({ format: "jwk" });
const hex = (b64url) => Buffer.from(b64url, "base64url").toString("hex");

const ec = jwk("auth-ec");
const rsa = jwk("auth-rsa");

writeFileSync(
  "packages/eid/src/mock/test-pki.ts",
  `/**
 * TEST-sleutels en -certificaten (gemaakt met scripts/make-test-pki.sh). NOOIT voor echt gebruik:
 * de privésleutels staan hier in het open. Ze laten de virtuele kaart echte handtekeningen maken
 * die de server (fase 7) kan controleren tegen de test-root.
 */

/** DER (base64) van de test-root, de test-Citizen CA en de authenticatiecertificaten. */
export const TEST_ROOT_CA = "${der("root")}";
export const TEST_CITIZEN_CA = "${der("citizen-ca")}";
export const TEST_AUTH_CERT_EC = "${der("auth-ec")}";
export const TEST_AUTH_CERT_RSA = "${der("auth-rsa")}";

/** EC P-384-privésleutel (scalar d, hex). */
export const TEST_AUTH_KEY_EC_D = "${hex(ec.d)}";

/** RSA 2048-privésleutel (modulus n en exponent d, hex). */
export const TEST_AUTH_KEY_RSA_N = "${hex(rsa.n)}";
export const TEST_AUTH_KEY_RSA_D = "${hex(rsa.d)}";
`,
);
