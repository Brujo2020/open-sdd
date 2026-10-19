#!/bin/sh
# open-sdd — the 60-second demo.
#
# Creates a throwaway repository in a temp directory, injects a small but REAL incoherence
# (an untraced requirement, a completed task with no evidence, an unfilled {{...}} placeholder
# and a declared contract that does not exist), runs THIS checkout's pinned CLI against it and
# prints the transcript. It exits non-zero if the tool fails to detect any of them: a demo that
# cannot fail is marketing, not a demo.
#
# Guarantees:
#   - POSIX sh (no bashisms), verified with `sh -n` and run under `sh`.
#   - Offline: no network, no npm install, no package registry. It only reads the pinned CLI.
#   - Writes only inside a fresh `mktemp -d`. Nothing is written to the repository or $HOME.
#   - The CLI is ALWAYS this checkout's tools/open-sdd/dist/cli.js. It never resolves the global
#     `open-sdd` on PATH (a v2.0.0 binary with different behaviour).

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(dirname -- "$SCRIPT_DIR")
CLI="$REPO_ROOT/tools/open-sdd/dist/cli.js"

if [ ! -f "$CLI" ]; then
  printf '%s\n' "ERROR: no existe $CLI" >&2
  printf '%s\n' "Compílalo primero:  npm --prefix tools/open-sdd install && npm --prefix tools/open-sdd run build" >&2
  exit 2
fi

TMPBASE=${TMPDIR:-/tmp}
while [ "${TMPBASE%/}" != "$TMPBASE" ]; do TMPBASE=${TMPBASE%/}; done
[ -n "$TMPBASE" ] || TMPBASE=/
WORK=$(mktemp -d "$TMPBASE/open-sdd-demo.XXXXXX")
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT INT HUP TERM

mkdir -p "$WORK/.sdd/specs/payments" "$WORK/src"

# ── A small, real spec triad in EARS form ─────────────────────────────────────────────────────
cat > "$WORK/.sdd/specs/payments/requirements.md" <<'SPEC'
# Requirements — payments

### REQ-PAY-001 — Refund a captured charge
WHEN a captured charge is refunded, the payments system SHALL record the refund within 24 hours.
SPEC

cat > "$WORK/.sdd/specs/payments/plan.md" <<'SPEC'
# Plan — payments

Refunds are recorded as compensating ledger entries; the original charge is never mutated.
SPEC

# ── The delta declares what changes. Two incoherences live here ───────────────────────────────
#   * REQ-PAY-011 has no task  → the obligation nobody will implement.
#   * REQ-PAY-010 declares test/ledger.test.ts as its contract, but that file does not exist.
cat > "$WORK/.sdd/specs/payments/delta.md" <<'SPEC'
# Delta: payments — Add refunds

Status: proposed

## ADDED

### REQ-PAY-010 — Refund a charge
- Statement: WHEN a captured charge is refunded, the ledger shall record a compensating entry.
- Targets: src/ledger.ts
- Contracts: test/ledger.test.ts
- Strangler: new

### REQ-PAY-011 — Audit trail
- Statement: WHEN a refund is recorded, the system shall append an audit entry.
- Targets: src/audit.ts
- Strangler: new

## MODIFIED

## REMOVED

## RENAMED
SPEC

# ── Two more incoherences in the task list ────────────────────────────────────────────────────
#   * T1 is marked complete with no `_Evidence:` line.
#   * T2 still carries the template placeholder instead of a requirement id.
cat > "$WORK/.sdd/specs/payments/tasks.md" <<'SPEC'
# Tasks — payments

- [x] T1 Implement refund endpoint _Requirements: REQ-PAY-010_
- [ ] T2 Emit the audit entry _Requirements: {{REQ-AREA-002}}_
SPEC

cat > "$WORK/src/ledger.ts" <<'CODE'
export const refund = (chargeId: string): string => `refund:${chargeId}`;
CODE

if [ -t 1 ]; then BOLD=$(printf '\033[1m'); DIM=$(printf '\033[2m'); OFF=$(printf '\033[0m'); else BOLD=; DIM=; OFF=; fi

say() { printf '\n%s%s%s\n' "$BOLD" "$1" "$OFF"; }
dim() { printf '%s%s%s\n' "$DIM" "$1" "$OFF"; }

printf '%s\n' "════════════════════════════════════════════════════════════════════════════"
printf '%s\n' " open-sdd — demo de 60 segundos (offline, repo desechable en $WORK)"
printf '%s\n' "════════════════════════════════════════════════════════════════════════════"
dim " CLI fijado: $CLI"
dim " El binario global «open-sdd» (v2.0.0) NO se usa: siempre el dist/ de este checkout."

say "1/3 · El estado y la fase del proyecto  →  node \"\$CLI\" status payments"
dim "     (evidencia 0/1 = una tarea completada sin la salida que la respaldaría)"
STATUS_OUT=$(cd "$WORK" && node "$CLI" status payments 2>&1)
printf '%s\n' "$STATUS_OUT"

say "2/3 · Trazabilidad y placeholders  →  node \"\$CLI\" delta validate payments"
DELTA_OUT=$(cd "$WORK" && node "$CLI" delta validate payments 2>&1)
printf '%s\n' "$DELTA_OUT"

say "3/3 · La cadena Zero-Trust (el marcador)  →  node \"\$CLI\" gates run"
set +e
GATES_OUT=$(cd "$WORK" && node "$CLI" gates run 2>&1)
GATES_EXIT=$?
set -e
printf '%s\n' "$GATES_OUT"

# ── The demo FAILS unless the tool actually detected every injected incoherence ────────────────
FAILED=0
expect() { # expect <label> <haystack> <needle>
  case "$2" in
    *"$3"*) printf '  %s %s\n' "DETECTADO" "$1" ;;
    *) printf '  %s %s  (falta: %s)\n' "NO DETECTADO" "$1" "$3"; FAILED=1 ;;
  esac
}

printf '\n%s\n' "Veredicto de la demo (el script falla si el motor no ve alguno):"
expect "requisito sin tarea (REQ-PAY-011)"            "$DELTA_OUT" "sin tarea: REQ-PAY-011"
expect "placeholder {{...}} sin rellenar (T2)"         "$DELTA_OUT" "UNFILLED_REQUIREMENT_PLACEHOLDER"
expect "tarea completada sin evidencia (T1)"           "$STATUS_OUT" "evidencia 0/1 tarea(s) completada(s)"
expect "contrato declarado que no existe"              "$STATUS_OUT" "declarados por la delta que no existen"
expect "la cadena NO pasa (score del gate)"            "$GATES_OUT" "La cadena NO pasa"
if [ "$GATES_EXIT" -ne 0 ]; then
  printf '  %s la cadena sale con código %s (no-cero)\n' "DETECTADO" "$GATES_EXIT"
else
  printf '  %s la cadena salió 0\n' "NO DETECTADO"; FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
  printf '\n%s\n' "DEMO FALLIDA: el motor no detectó todo lo que este repositorio contiene de verdad."
  exit 1
fi

cat <<EOF

════════════════════════════════════════════════════════════════════════════
 Todo detectado. Ahora, en TU repositorio propio:
════════════════════════════════════════════════════════════════════════════
   cd /ruta/a/tu/repositorio
   node "$CLI" status
   node "$CLI" delta validate <feature>
   node "$CLI" gates run

 Nada se ha escrito fuera de $WORK
 (se borra al salir). Sin red, sin npm install, sin tocar tu repo.
EOF
