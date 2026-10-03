/*
 * Nep-PC/SC-bibliotheek om de koffi-koppeling (native.ts) te testen zonder kaartlezer.
 * Twee varianten:
 *   standaard     = pcsc-lite-ABI (Linux): DWORD/LONG = long, handles = long
 *   -DMAC_ABI     = macOS-ABI: DWORD = uint32, LONG/handles = int32, packed structs
 * Lezer "Fake Reader A" heeft een kaart, "Fake Reader B" is leeg.
 * SCardTransmit geeft het commando omgekeerd terug, gevolgd door 90 00.
 */
#include <stdint.h>
#include <string.h>
#include <unistd.h>

#ifdef MAC_ABI
typedef uint32_t DWORD;
typedef int32_t LONG;
typedef int32_t SCARDCONTEXT;
typedef int32_t SCARDHANDLE;
#pragma pack(push, 1)
#else
typedef unsigned long DWORD;
typedef long LONG;
typedef long SCARDCONTEXT;
typedef long SCARDHANDLE;
#endif

typedef struct {
  const char *szReader;
  void *pvUserData;
  DWORD dwCurrentState;
  DWORD dwEventState;
  DWORD cbAtr;
  unsigned char rgbAtr[33];
} SCARD_READERSTATE;

typedef struct {
  DWORD dwProtocol;
  DWORD cbPciLength;
} SCARD_IO_REQUEST;

#ifdef MAC_ABI
#pragma pack(pop)
#endif

#define OK 0
#define E_CANCELLED ((LONG)0x80100002)
#define E_INVALID_PARAMETER ((LONG)0x80100004)
#define E_INSUFFICIENT_BUFFER ((LONG)0x80100008)
#define E_UNKNOWN_READER ((LONG)0x80100009)
#define E_TIMEOUT ((LONG)0x8010000A)
#define E_NO_SMARTCARD ((LONG)0x8010000C)

static const unsigned char ATR[] = {0x3b, 0x7f, 0x96, 0x00, 0x00, 0x80, 0x31, 0x80, 0x65, 0xb0};
static const char READERS[] = "Fake Reader A\0Fake Reader B\0";
static volatile int cancelled = 0;
static int next_context = 1000;
/* Afwijkend gedrag nabootsen: bij time-out 0 E_TIMEOUT geven, ook als de toestand veranderde. */
static int windows_timeout_quirk = 0;
void FakeSetWindowsTimeoutQuirk(int on) { windows_timeout_quirk = on; }

/* Testhulp: grootte van de structs, om de ABI te controleren. */
int FakeSizeofReaderState(void) { return (int)sizeof(SCARD_READERSTATE); }
int FakeSizeofIoRequest(void) { return (int)sizeof(SCARD_IO_REQUEST); }

LONG SCardEstablishContext(DWORD scope, const void *r1, const void *r2, SCARDCONTEXT *ctx) {
  (void)scope; (void)r1; (void)r2;
  *ctx = next_context++;
  return OK;
}

LONG SCardReleaseContext(SCARDCONTEXT ctx) { (void)ctx; return OK; }

LONG SCardCancel(SCARDCONTEXT ctx) { (void)ctx; cancelled = 1; return OK; }

LONG SCardListReaders(SCARDCONTEXT ctx, const char *groups, char *readers, DWORD *len) {
  (void)ctx; (void)groups;
  DWORD needed = sizeof(READERS); /* incl. laatste \0 */
  if (readers == NULL) { *len = needed; return OK; }
  if (*len < needed) { *len = needed; return E_INSUFFICIENT_BUFFER; }
  memcpy(readers, READERS, needed);
  *len = needed;
  return OK;
}

static DWORD state_of(const char *reader, int *known) {
  *known = 1;
  if (strcmp(reader, "Fake Reader A") == 0) return 0x0020; /* PRESENT */
  if (strcmp(reader, "Fake Reader B") == 0) return 0x0010; /* EMPTY */
  *known = 0;
  return 0x0004 | 0x0008; /* UNKNOWN | UNAVAILABLE */
}

LONG SCardGetStatusChange(SCARDCONTEXT ctx, DWORD timeout, SCARD_READERSTATE *states, DWORD n) {
  (void)ctx;
  int changed = 0;
  for (DWORD i = 0; i < n; i++) {
    int known;
    DWORD now = state_of(states[i].szReader, &known);
    if (!known) return E_UNKNOWN_READER;
    if ((states[i].dwCurrentState & ~0x0002u) != now) { now |= 0x0002; changed = 1; }
    states[i].dwEventState = now;
    if (now & 0x0020) {
      states[i].cbAtr = sizeof(ATR);
      memcpy(states[i].rgbAtr, ATR, sizeof(ATR));
    } else {
      states[i].cbAtr = 0;
    }
  }
  if (changed) return (windows_timeout_quirk && timeout == 0) ? E_TIMEOUT : OK;
  /* Niets veranderd: wachten tot time-out of annulering. */
  for (DWORD waited = 0; waited < timeout; waited += 10) {
    if (cancelled) { cancelled = 0; return E_CANCELLED; }
    usleep(10000);
  }
  return E_TIMEOUT;
}

LONG SCardConnect(SCARDCONTEXT ctx, const char *reader, DWORD share, DWORD protocols, SCARDHANDLE *handle, DWORD *active) {
  (void)ctx;
  if (share != 2 || protocols != 3) return E_INVALID_PARAMETER;
  int known;
  DWORD state = state_of(reader, &known);
  if (!known) return E_UNKNOWN_READER;
  if (!(state & 0x0020)) return E_NO_SMARTCARD;
  *handle = 77;
  *active = 2; /* T=1 */
  return OK;
}

LONG SCardTransmit(SCARDHANDLE h, const SCARD_IO_REQUEST *send_pci, const unsigned char *send, DWORD send_len,
                   SCARD_IO_REQUEST *recv_pci, unsigned char *recv, DWORD *recv_len) {
  (void)recv_pci;
  if (h != 77 || send_pci == NULL || send_pci->dwProtocol != 2 || send_pci->cbPciLength != sizeof(SCARD_IO_REQUEST))
    return E_INVALID_PARAMETER;
  if (*recv_len < send_len + 2) return E_INSUFFICIENT_BUFFER;
  for (DWORD i = 0; i < send_len; i++) recv[i] = send[send_len - 1 - i];
  recv[send_len] = 0x90;
  recv[send_len + 1] = 0x00;
  *recv_len = send_len + 2;
  return OK;
}

LONG SCardBeginTransaction(SCARDHANDLE h) { return h == 77 ? OK : E_INVALID_PARAMETER; }
LONG SCardEndTransaction(SCARDHANDLE h, DWORD disposition) { (void)disposition; return h == 77 ? OK : E_INVALID_PARAMETER; }
LONG SCardDisconnect(SCARDHANDLE h, DWORD disposition) { (void)disposition; return h == 77 ? OK : E_INVALID_PARAMETER; }
