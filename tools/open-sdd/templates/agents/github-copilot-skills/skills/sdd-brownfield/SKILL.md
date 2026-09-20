---
name: sdd-brownfield
description: Govern an existing codebase with open-sdd: reconnaissance, descriptive constitution, delta specs, impact/contracts/reuse analysis and the rigor ladder, with the constitution as the pivot that validates every spec. Use when the code already exists and is the de facto source of truth.
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
argument-hint: [target|feature]
---

# sdd-brownfield Skill

## Misión

Gobernar un repositorio que **ya existe**. Una regla manda sobre todas las demás:

> El código existente es la fuente de verdad de facto: **no reinventes la arquitectura, gobiérnala**.

Este skill **complementa** a `/sdd-getspecs` (arranca steering y semillas de spec desde el código) y a
`/sdd-steering` (mantiene la memoria del proyecto). No los sustituye: cuando ya hay `.sdd/` y el
trabajo es **cambiar** un sistema en producción, el camino es este.

## Cuándo usarlo

- Hay código real y `.sdd/specs/` vacío, incompleto o desalineado con el código.
- Vas a cambiar un sistema en producción y necesitas saber qué se rompe antes de escribirlo.
- Necesitas una constitución que describa lo que el código ya cumple, no un ideal.

No lo uses para greenfield (`/sdd-discovery`), para una feature pequeña sobre un proyecto que ya tiene
steering y specs (`/sdd-spec-quick`) ni como sustituto de `/sdd-getspecs` en el primer contacto.

## Mnemotecnia (Manual Maestro SDD v3.0)

- **ADSR** — `Added`, `Deleted/Removed`, `Spec`, `Renamed`: las cuatro secciones de una delta. Si una
  sección va vacía, que sea una decisión, no un olvido.
- **EARS** — la forma comprobable del requisito: `WHEN <disparador> the <componente> shall <respuesta>`.
  Un requisito que no se puede comprobar no es un requisito.
- **EGTAV** — las cinco capas: **E**specificación, **G**eneración, **T**areas, **A**rtefactos,
  **V**alidación. En brownfield la capa que más pesa es la V: validar contra el sistema que ya existe.

## Los 5 pasos

### 1. Reconocer — qué es este proyecto ya, con evidencia

```bash
open-sdd brownfield bootstrap . --focus "el área que te importa"
```

`bootstrap` es el punto de entrada único: compone el reconocimiento, la constitución descriptiva, el
mapa de módulos, el documento de inteligencia de código y el plan ordenado de pasos. Para solo la
evidencia, `open-sdd brownfield survey .`.

### 2. Anclar — la constitución descriptiva

```bash
open-sdd brownfield constitution . --write
```

Escribe `.sdd/steering/constitution.md`. **Solo lo que el código ya cumple**, cada principio con su
evidencia. Un principio descriptivo sin evidencia es un error de validación; lo deseado-pero-ausente
queda como **enmienda propuesta**, nunca como hecho. El stack es un hecho establecido, no una opinión.

### 3. Describir el cambio — la delta es el contrato del cambio

```bash
open-sdd delta init <feature> "qué cambia"
open-sdd delta validate <feature>
```

La delta describe **solo lo que cambia**, no la spec de todo el sistema, con ids acotados
`REQ-<AREA>-<NNN>` y las secciones ADSR. `MODIFIED`/`REMOVED`/`RENAMED` declaran el comportamiento
`previous` que sustituyen; `REMOVED` añade además `rationale` y `contracts`.

### 4. Comprobar — antes de escribir el cambio

```bash
open-sdd status <feature> --check          # alineación constitucional: el pivote
open-sdd brownfield impact <feature>       # radio de impacto y cambios de ruptura
open-sdd brownfield contracts <feature>    # el oráculo de regresión; --verify lo ejecuta
open-sdd brownfield reuse <feature> --symbols A,B
open-sdd govern rigor                      # el nivel declarado y sus gates
```

### 5. Entregar — evidencia, gates y un único panel

La evidencia va **en las tareas**, no en el chat. Corren los gates del nivel declarado. `status` es el
único panel: constitución, specs, delta, contratos, alineación y próximos pasos en una pantalla.

```bash
open-sdd status --check
```

## La constitución es el PIVOTE

No es un documento decorativo: es la referencia contra la que se valida **cada** spec. Un principio
que la spec cita y no existe en vigor es una **autoridad fantasma** (error); una spec que no cita
ninguno deja el pivote **sin usar** (aviso); un requisito que contradice un `MUST` se reporta.

Ejemplo real de este repositorio: `.sdd/steering/constitution.md` define `C-API-COMPAT` (nivel `MUST`,
evidencia `tools/open-sdd/src/core/index.ts; tools/open-sdd/src/index.ts`). La delta de
`.sdd/specs/brownfield-support/` tiene una entrada (`REQ-BF-005`) cuyo objetivo es
`tools/open-sdd/src/index.ts` — justo el fichero que `C-API-COMPAT` protege. Por eso esa spec **debe**
citar `C-API-COMPAT`:

- si citara `C-SOLO-CONSOLA` (un id que no existe), `open-sdd status --check` reporta **autoridad
  fantasma** (`UNKNOWN_PRINCIPLE`, error) y sale con código 1;
- si no citara ninguno, reporta el **pivote sin usar** (`NO_PRINCIPLES_DECLARED`, aviso);
- si un requisito dijera "sustituir el punto de entrada sin ruta de migración", contradice el `MUST`.

Estado real hoy: `.sdd/specs/brownfield-support/` declara los cuatro principios (`_Constitution:`),
`open-sdd status --check` reporta **alineación 100 %**, ningún principio en vigor sin mencionar, **0
errores y 1 aviso** (`BOUNDARY_VIOLATION`: `.sdd/settings/rigor.json` queda fuera de las fronteras
declaradas). Y `open-sdd govern constitution --matrix` reporta **cobertura 50 %**: `C-API-COMPAT` y
`C-REGRESSION-ORACLE` salen `cubierto`; `C-STACK-FACT` y `C-BOUNDARIES` salen `hueco` porque su
evidencia es un hecho y una lista de directorios, no un `fichero:línea`.

## La escalera de exigencia

Acumulativa: subir de nivel solo **añade** comprobaciones. El nivel por defecto es fluido a propósito.

| Nivel | Añade | Gates |
|---|---|---|
| **spec-first** (por defecto) | constitución válida + requisitos en EARS. Nada más: sin evidencia, drift, contratos ni regeneración. | C1, C2 |
| **spec-anchored** | + delta (brownfield), trazabilidad, ligado de evidencia y detección de drift | C1, C2, C3, C6 |
| **spec-as-source** | + contratos declarados y regeneración desde la spec como reparación | C1, C2, C3, C4, C5, C6 |

**C2 (secretos y comandos destructivos) está activo en todos los niveles**: es el suelo duro, no un
ajuste de rigor. Se configura con `open-sdd govern rigor --set <nivel> --rationale "..."`, y un nivel
sin motivo declarado no es auditable.

El objetivo es que la experiencia **no estorbe**: `status` es un panel, no un muro, y lo que corre en
cada commit es `open-sdd govern rigor --no-drift --quiet` (una línea, veredicto en el código de
salida); `open-sdd status --quiet` deja el panel entero en una sola línea.

## Buscar antes de crear (reuse-first)

Antes de generar una clase o un método nuevos, busca si ya existe algo reutilizable:
`open-sdd brownfield reuse <feature>`. Crear código nuevo solo es legítimo cuando no existe nada
reutilizable — en este repositorio esa política está en la enmienda **propuesta** `AMD-REUSE-FIRST`,
así que el informe es un aviso, no un gate.

## Reglas de honestidad

1. **Nunca declares un aprobado de algo que no has inspeccionado.** Si no lo has ejecutado, dilo.
2. Un **test en verde con un contrato declarado ausente no es un aprobado**: `contracts --verify` exige
   código de salida 0 **y** que todos los contratos declarados estén presentes.
3. La constitución es **descriptiva**: una práctica deseada pero ausente se propone como enmienda, no
   se afirma como principio en vigor.
4. No repitas medidas de prototipo del paper como si fueran medidas de este repositorio.

## Qué no hace todavía

`status` es un panel que se lee y `status --check` no bloquea nada en CI. La delta no se fusiona de
vuelta en la spec base (G-17) y `brownfield impact`/`reuse` son informes con falsos positivos conocidos,
no gates (G-19). El mapa de módulos cubre hoy workspaces Node/TypeScript, no Maven/Gradle, Go, Rust ni
monorepos Python (G-21), y `bootstrap --write` escribe el documento de inteligencia y la constitución,
pero **no** la semilla de delta que su propio plan lista (G-20). Los límites reales están declarados en
`docs/PAPER-ALIGNMENT.md` y resumidos en `docs/guides/brownfield-quickstart.md`.
