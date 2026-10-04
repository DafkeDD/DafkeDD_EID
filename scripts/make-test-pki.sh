#!/usr/bin/env bash
# Maakt een TEST-PKI die lijkt op die van de Belgische eID (alleen voor tests!):
#   Test Root CA (RSA) → Test Citizen CA (RSA) → authenticatiecertificaten voor
#   "Jan Pieter Specimen": EC P-384 (zoals applet 1.8) en RSA 2048 (zoals applet 1.7),
#   plus een ingetrokken certificaat en een vreemde root voor negatieve tests (fase 7).
# Resultaat: tests/fixtures/pki/*.pem en packages/eid/src/mock/test-pki.ts.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=tests/fixtures/pki
mkdir -p "$OUT"
cd "$OUT"
rm -f *.pem *.srl *.cnf

cat > ext.cnf <<'CNF'
[req]
distinguished_name = dn
[dn]
[v3_root]
basicConstraints = critical, CA:true, pathlen:1
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
[v3_sub]
basicConstraints = critical, CA:true, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
[v3_auth]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = clientAuth
certificatePolicies = 2.16.56.12.1.1.2.2
authorityKeyIdentifier = keyid
CNF

SUBJ='/C=BE/CN=Jan Specimen (Authentication)/SN=Specimen/GN=Jan Pieter/serialNumber=85031512369'

openssl req -x509 -new -newkey rsa:2048 -nodes -keyout root.key.pem -out root.pem -days 7300 \
  -subj '/C=BE/CN=DafkeDD TEST Root CA' -extensions v3_root -config ext.cnf 2>/dev/null
openssl req -new -newkey rsa:2048 -nodes -keyout citizen-ca.key.pem -out citizen-ca.csr -subj '/C=BE/CN=DafkeDD TEST Citizen CA' 2>/dev/null
openssl x509 -req -in citizen-ca.csr -CA root.pem -CAkey root.key.pem -CAcreateserial -out citizen-ca.pem -days 7000 -extfile ext.cnf -extensions v3_sub 2>/dev/null

openssl ecparam -name secp384r1 -genkey -noout -out auth-ec.key.pem
openssl req -new -key auth-ec.key.pem -out auth-ec.csr -subj "$SUBJ" 2>/dev/null
openssl x509 -req -in auth-ec.csr -CA citizen-ca.pem -CAkey citizen-ca.key.pem -CAcreateserial -out auth-ec.pem -days 3650 -extfile ext.cnf -extensions v3_auth 2>/dev/null

openssl genrsa -out auth-rsa.key.pem 2048 2>/dev/null
openssl req -new -key auth-rsa.key.pem -out auth-rsa.csr -subj "$SUBJ" 2>/dev/null
openssl x509 -req -in auth-rsa.csr -CA citizen-ca.pem -CAkey citizen-ca.key.pem -CAcreateserial -out auth-rsa.pem -days 3650 -extfile ext.cnf -extensions v3_auth 2>/dev/null

openssl ecparam -name secp384r1 -genkey -noout -out auth-revoked.key.pem
openssl req -new -key auth-revoked.key.pem -out auth-revoked.csr -subj '/C=BE/CN=Ingetrokken Specimen (Authentication)/serialNumber=05061224655' 2>/dev/null
openssl x509 -req -in auth-revoked.csr -CA citizen-ca.pem -CAkey citizen-ca.key.pem -CAcreateserial -out auth-revoked.pem -days 3650 -extfile ext.cnf -extensions v3_auth 2>/dev/null

openssl req -x509 -new -newkey rsa:2048 -nodes -keyout rogue-root.key.pem -out rogue-root.pem -days 7300 \
  -subj '/C=BE/CN=Belgium Root CA4' -extensions v3_root -config ext.cnf 2>/dev/null
openssl ecparam -name secp384r1 -genkey -noout -out auth-rogue.key.pem
openssl req -new -key auth-rogue.key.pem -out auth-rogue.csr -subj "$SUBJ" 2>/dev/null
openssl x509 -req -in auth-rogue.csr -CA rogue-root.pem -CAkey rogue-root.key.pem -CAcreateserial -out auth-rogue.pem -days 3650 -extfile ext.cnf -extensions v3_auth 2>/dev/null

rm -f *.csr *.srl ext.cnf
cd - >/dev/null
node scripts/make-test-pki-ts.mjs
echo "Test-PKI gemaakt in $OUT"
