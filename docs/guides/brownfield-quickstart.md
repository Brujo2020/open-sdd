# Brownfield en 10 minutos

Guía corta para gobernar un repositorio **que ya existe** con Open-SDD. La regla que manda sobre
todas las demás:

> El código existente es la fuente de verdad de facto: **no reinventes la arquitectura, gobiérnala**.

Todo lo que sigue se ejecuta desde la raíz del repositorio. Los comandos usan `open-sdd`; si no lo
tienes en el `PATH`, sustituye `open-sdd` por `node tools/open-sdd/dist/cli.js`.

El manual del agente es el skill `/sdd-brownfield` (se instala con el resto de skills). Esta guía y
ese skill dicen lo mismo: aquí está la ruta, allí está el protocolo.

## Los 6 comandos, en orden

### 1. `open-sdd brownfield bootstrap .` — reconocer y planificar

Un solo punto de entrada: reconocimiento + constitución + mapa de módulos + inteligencia del código +
el plan ordenado de pasos. No escribe nada sin `--write`.

```text
Bootstrap brownfield — @brujo2020/open-sdd

  raíz: /Users/mramospe/Proyectos/open-sdd
  stack: TypeScript · tests: Vitest

  Mapa de módulos (2)
    .  @brujo2020/open-sdd
      posee: package.json
      responsabilidades: expone un ejecutable CLI (declarado en package.json bin)
    tools/open-sdd  open-sdd
      posee: tools/open-sdd/package.json, tools/open-sdd/src, tools/open-sdd/test
      responsabilidades: expone un ejecutable CLI (declarado en package.json bin)
      tests: tools/open-sdd/test

  Artefactos
    keep               .sdd/steering/constitution.md
        ya existe una constitución: no se sobrescribe; cualquier cambio entra como enmienda gobernada
    create             .sdd/steering/codebase-intelligence.md
        no existe: el bootstrap escribe el documento de inteligencia del código

  Plan de bootstrap: 2 módulo(s), 1 artefacto(s) por crear, 0 por regenerar, 1 conservado(s).

  Añade --write para escribir el documento de inteligencia y generar la constitución si falta.
```

| Flag | Qué hace |
|---|---|
| `--focus "<texto>"` | nombra el primer cambio: prepara la semilla de delta del foco y la incluye en los pasos |
| `--write` | escribe `.sdd/steering/codebase-intelligence.md` y, si falta, genera la constitución |
| `--json` | emite el plan como JSON (para pipear) |

Nada se reporta como inspeccionado si no lo fue: una responsabilidad vacía significa que la evidencia
no la sostiene, no que el módulo no tenga ninguna.

### 2. `open-sdd brownfield survey .` — la evidencia, sola

Si solo quieres el reconocimiento, sin plan. Esto es lo que imprime en este repositorio:

```text
Reconocimiento — @brujo2020/open-sdd

  lenguaje: TypeScript
  gestor de paquetes: npm
  build: tsc
  tests: Vitest
  módulos (9): agents, cli, constants, core, manifest, plan, resolvers, template, utils

  Evidencia recogida (5):
    · stack: TypeScript, npm, tsc
    · API pública: 2 punto(s) de entrada
```

### 3. `open-sdd brownfield constitution . --write` — anclar

Escribe `.sdd/steering/constitution.md`. **Solo lo que el código ya cumple**, cada principio con su
evidencia; lo deseado-pero-ausente queda como **enmienda propuesta**. El stack es un hecho establecido,
no una opinión. En este repositorio:

```text
Constitución reversa — @brujo2020/open-sdd

  principios en vigor: 4 · enmiendas propuestas: 2

  C-STACK-FACT (MUST) — El stack actual es un hecho establecido
      evidencia: package manager: npm; lockfile: tools/open-sdd/package-lock.json; build tool: tsc
  C-API-COMPAT (MUST) — Preservar la compatibilidad de la API pública
      evidencia: tools/open-sdd/src/core/index.ts; tools/open-sdd/src/index.ts
  C-BOUNDARIES (SHOULD) — Seguir los límites de servicio existentes
      evidencia: agents; cli; constants; core; manifest; plan; resolvers; template
  C-REGRESSION-ORACLE (MUST) — Los tests existentes son el oráculo de regresión
      evidencia: Vitest; tools/open-sdd/test
```

Un principio descriptivo **sin evidencia es un error de validación**: no se admite como hecho.

### 4. `open-sdd delta init` + `open-sdd delta validate` — describir el cambio

La delta es el **contrato del cambio**, no la spec de todo el sistema. Cuatro secciones —**ADSR**
(`Added`, `Deleted/Removed`, `Spec`, `Renamed`)— y un id acotado `REQ-<AREA>-<NNN>` por entrada.

```bash
open-sdd delta init <feature> "qué cambia"
open-sdd delta validate <feature>
```

Ejemplo real (`.sdd/specs/brownfield-support/delta.md`, 14 entradas):

```text
Validación de la delta — brownfield-support

  aviso              brownfield-support EMPTY_SECTION
      La sección REMOVED está vacía. Las deltas describen solo lo que cambia: si de verdad no
      cambia nada de este tipo, es correcto — pero conviene que sea una decisión y no un olvido (ADSR).

  0 error(es), 1 aviso(s).
  Trazabilidad: 14/14 requisito(s) de la delta con tarea (100%).
```

`MODIFIED`, `REMOVED` y `RENAMED` deben declarar el comportamiento `previous` que sustituyen;
`REMOVED` exige además `rationale` y `contracts`. Los requisitos van en forma **EARS**
(`WHEN <disparador> the <componente> shall <respuesta>`): un requisito que no se puede comprobar no
es un requisito.

### 5. `open-sdd status --check` y los informes — comprobar antes de escribir

```bash
open-sdd status <feature> --check     # alineación constitucional: el pivote
open-sdd brownfield impact <feature>  # radio de impacto y cambios de ruptura
open-sdd brownfield contracts <feature> [--verify]
open-sdd brownfield reuse <feature> [--symbols A,B]
open-sdd govern rigor
```

Salidas reales de este repositorio (las cifras se mueven con el cambio pendiente: son una foto del
árbol de trabajo, no un número fijo):

```text
Impacto del cambio — brownfield-support (35 fichero(s))
  radio de impacto: 0 fichero(s) alcanzable(s) desde el cambio
  superficie de API tocada: tools/open-sdd/src/core/index.ts, tools/open-sdd/src/index.ts

Contratos de ejecución — brownfield-support
  oráculo: 15 contrato(s) · comando npx vitest run (derivado, no verificado)

Reutilización primero — brownfield-support
  Reutilización primero: 13 símbolo(s) pedido(s), 0 candidato(s) ≥ 0.6, 0 violación(es).
```

`contracts --verify` ejecuta el comando de test y exige **código de salida 0 y que todos los
contratos declarados existan**: un test en verde con un contrato declarado ausente **no es un
aprobado** (en este repositorio sale 1 precisamente por eso). `reuse` es la regla de buscar antes de
crear: crear código nuevo solo es legítimo cuando no existe nada reutilizable, y `reuse --symbols A,B`
sale 1 cuando encuentra un candidato que ya existe.

```text
Rigor: spec-first (brownfield) · gates activos: C1, C2
exige: constitution, triad
✓ sin hallazgos: cumples lo que exige spec-first.
```

### 6. `open-sdd status` — el único panel

Cuando el cambio ya está en marcha, `status` es el panel: constitución, specs, delta, contratos,
alineación constitucional, rigor y la próxima acción. `open-sdd status <feature>` da el detalle,
`--json` lo emite para herramientas y `--quiet` deja una sola línea para el commit.

```text
Constitución
Constitución — presente y válida · 4 principio(s) en vigor · 2 enmienda propuesta (sin entrar en vigor)
Specs
Specification: brownfield-support — Phase: verified · tríada completa · trazabilidad 14/14 · evidencia 10/10 tarea(s) completada(s)
Delta
Delta de brownfield-support — ADDED 13 · MODIFIED 1 · REMOVED 0 · RENAMED 0 (total 14) · Estrangulamiento: 14/14 entradas completamente en el camino nuevo
Contratos
Contratos de brownfield-support — 13 contrato(s): 2 descubierto(s), 11 declarado(s) · 17 cambio(s) sin cobertura · comando npx vitest run
Constitucional
Constitucional — declarados: C-STACK-FACT, C-API-COMPAT, C-BOUNDARIES, C-REGRESSION-ORACLE · alineación 100% · 1 hallazgo(s) (BOUNDARY_VIOLATION (C-BOUNDARIES))
Rigor
Rigor — spec-first · gates activos C1, C2 · brownfield
Siguiente
Siguiente — open-sdd brownfield contracts brownfield-support --write
```

Con `--quiet` (lo que corre en un commit) imprime una sola línea y deja el veredicto en el código de
salida:

```text
spec-first · warn · open-sdd brownfield contracts brownfield-support --write
```

## El pivote: la constitución valida cada spec

La constitución no es un documento decorativo. `open-sdd status --check` la usa como referencia
contra la que se valida **cada** spec, y `open-sdd govern constitution --matrix` publica la
cobertura principio → artefacto.

Ejemplo real de este repositorio. `.sdd/steering/constitution.md` define `C-API-COMPAT` (`MUST`,
evidencia `tools/open-sdd/src/core/index.ts; tools/open-sdd/src/index.ts`). La delta de
`.sdd/specs/brownfield-support/` tiene una entrada (`REQ-BF-005`) cuyo objetivo es
`tools/open-sdd/src/index.ts`, justo el fichero que `C-API-COMPAT` protege. Por eso esa spec debe citar
`C-API-COMPAT`:

- si citara un id que no existe (por ejemplo `C-SOLO-CONSOLA`), `status --check` reporta **autoridad
  fantasma** (`UNKNOWN_PRINCIPLE`, error) y **sale con código 1**;
- si no citara ninguno, reporta el **pivote sin usar** (`NO_PRINCIPLES_DECLARED`, aviso);
- si un requisito contradijera un `MUST` (por ejemplo, sustituir el punto de entrada sin ruta de
  migración), se reporta la contradicción.

Estado real hoy en este repositorio: la spec declara los cuatro principios, `status --check` reporta
**alineación 100 %**, ningún principio en vigor sin mencionar, **0 errores y 1 aviso** —
`BOUNDARY_VIOLATION`, porque `.sdd/settings/rigor.json` queda fuera de las fronteras declaradas:

```text
Constitucional — declarados: C-STACK-FACT, C-API-COMPAT, C-BOUNDARIES, C-REGRESSION-ORACLE
                 · alineación 100% · 1 hallazgo(s) (BOUNDARY_VIOLATION (C-BOUNDARIES))
Alineación constitucional de "brownfield-support": 4/4 principio(s) declarado(s) resuelven a un
  principio en vigor (alineación 100%); ningún principio en vigor queda sin mencionar; 0 error(es)
  y 1 aviso(s).
```

`govern constitution --matrix` marca `C-API-COMPAT` y `C-REGRESSION-ORACLE` como `cubierto` (su
evidencia es un fichero real) y `C-STACK-FACT` y `C-BOUNDARIES` como `hueco` (su evidencia es un hecho
y una lista de directorios, no un `fichero:línea`): la cobertura real de este repositorio es del
**50 %**, y decirlo es el trabajo.

## La escalera de exigencia

Acumulativa: subir de nivel solo **añade**. El nivel por defecto es fluido a propósito.

| Nivel | Añade | Gates |
|---|---|---|
| **spec-first** (por defecto) | constitución válida + requisitos en EARS; nada de evidencia, drift, contratos ni regeneración | C1, C2 |
| **spec-anchored** | + delta (brownfield), trazabilidad, ligado de evidencia y detección de drift | C1, C2, C3, C6 |
| **spec-as-source** | + contratos declarados y regeneración desde la spec como reparación | C1, C2, C3, C4, C5, C6 |

**C2 (secretos y comandos destructivos) está activo en todos los niveles**: es el suelo duro que nunca
se auto-autoriza, no un ajuste de rigor. Se sube con
`open-sdd govern rigor --set spec-anchored --rationale "por qué"`; un nivel sin motivo declarado no
es auditable.

## FAQ

**¿Tengo que escribir la spec de todo el sistema?**
No. La unidad es la **delta**: solo lo que cambia. Escribir la spec del sistema entero es justo lo que
el brownfield no puede permitirse; por eso la spec del sistema se extrae del código (reconocimiento +
constitución) y el cambio se especifica aparte.

**¿Y si mi constitución está mal?**
`open-sdd status --check` te dice qué principio falta, cuál se cita sin existir, o qué requisito
contradice un principio en vigor. Para la cobertura principio → artefacto, `open-sdd govern
constitution --matrix`. Y un principio descriptivo sin evidencia no pasa la validación de la propia
constitución.

**¿Esto me va a bloquear los commits?**
El hook solo exige lo que **tu nivel declara**, y corre con `--quiet`: una línea y el veredicto en el
código de salida, no una auditoría. En `spec-first` eso es una constitución válida y requisitos en
EARS; C2 corre siempre. Si algo bloquea y es un falso positivo legítimo, se declara en
`.sdd/settings/security-allowlist.json` con un motivo — nunca con `--no-verify`.

**¿Por dónde empiezo si no hay ni `.sdd/`?**
`open-sdd brownfield bootstrap . --write`. Y si necesitas steering + semillas de spec para todo el
proyecto, `/sdd-getspecs`; este flujo lo complementa, no lo sustituye.

## Qué NO hace todavía

Honestidad primero: esto es lo que el código **no** hace hoy, con su brecha declarada en
[docs/PAPER-ALIGNMENT.md](../PAPER-ALIGNMENT.md).

- **La delta no se fusiona de vuelta en la spec base** (G-17). `merged` es una etiqueta que escribe un
  autor en `delta.md`, no un estado que produzca un comando: aplicar la delta es manual y el drift
  entre la delta y la base no se comprueba.
- **`brownfield impact` tiene falsos positivos conocidos** (G-19): directorios sin seguimiento, un
  entry point público tocado pero declarado `ADDED`, un objetivo `ADDED` que legítimamente aún no
  existe, y artefactos de build bajo `tools/open-sdd/dist/**`. Es un **informe de revisión, no un gate**,
  y por eso no está en CI.
- **`brownfield impact` y `reuse` consultan el código, no la constitución** (G-18). `impact` no nombra
  qué principios constitucionales toca el cambio; `reuse` es un aviso porque `AMD-REUSE-FIRST` sigue
  siendo una enmienda **propuesta**.
- **La verificación de contratos no está en CI** (G-15): el oráculo se ejecuta cuando alguien pasa
  `--verify`, no en cada pull request.
- **El mapa de módulos cubre hoy workspaces Node/TypeScript** (G-21). El descubrimiento de workspaces
  sale del `workspaces` de `package.json` y de directorios con `package.json`; no hay descubrimiento de
  Maven/Gradle, Go, Rust ni monorepos Python, así que en esos repositorios el mapa devuelve **un único
  módulo raíz** (honesto, pero más estrecho que el issue #1436 de spec-kit: el concepto se adopta sobre
  nuestro motor, la cobertura de lenguajes no). La constitución usa además otro vocabulario de fronteras
  (G-22), y `publicApiFiles` se busca por nombre de fichero, no en el manifiesto (G-23).
- **`bootstrap --write` no escribe la semilla de delta** que su propio plan lista como `create` (G-20):
  escribe el documento de inteligencia y la constitución; la semilla la crea `delta init`, que es el
  paso 5 del plan.
- **La matriz de constitución y `status --check` no bloquean nada**: son informes que un revisor lee
  (G-16). Ningún gate falla porque un principio no tenga artefacto.
- **Las medidas del paper no son medidas de este repositorio** (G-01/G-02). No las cites como si lo
  fueran.
