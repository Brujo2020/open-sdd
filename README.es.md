# open-sdd

**La capa que hace verificable el «hecho» de una IA.**

`open-sdd` instala un flujo de trabajo spec-driven en el agente de código que ya usas, y después lo
somete a tres cosas que un prompt de chat no puede dar: **gates ejecutables** que deciden pasa o no
pasa, **specs delta** para el código que ya existe y una **constitución** contra la que se valida cada
spec. Es agnóstico de modelo, vive en Git junto a tu código y reporta lo que realmente inspeccionó
—incluido lo que no.

- **Un CLI, muchos anfitriones.** 18 definiciones de agente en 8 variantes basadas en skills (168
  plantillas `SKILL.md` en este repositorio).
- **Las specs viven en el repositorio.** `.sdd/specs/<feature>/` guarda la Tríada Documental
  (`requirements.md` en EARS, `plan.md`, `tasks.md`), versionada y revisada como el código.
- **Brownfield primero.** El código existente es la fuente de verdad de facto; la unidad de
  especificación es la **delta**, y `/sdd-getspecs` reingenieriza el steering y las semillas de spec
  editables de un código que no las tiene.
- **Gobernanza que puedes inspeccionar.** `gates`, `govern` y `assure` exponen la cadena, los
  invariantes, los umbrales HITL, el modelo de amenazas y las brechas declaradas como salida
  determinista de consola.
- **Honesto por construcción.** Un control declarado pero no implementado se reporta como tal, no se
  ejecuta en silencio como un éxito vacío.

<!-- Solo se muestran los badges que hoy resuelven.
     Los badges de versión npm y de tamaño de instalación quedan ocultos hasta que se publique la
     v3.0.2: el nombre con scope @brujo2020/open-sdd existe en el registro, pero `latest` es el
     binario antiguo v2.0.0 (otra herramienta — ver «Paquete publicado»). Un badge que dijera 2.0.0
     en este README anunciaría el artefacto equivocado. Descomenta las dos líneas cuando salga la
     v3.0.2. -->
[![Licencia: MIT](https://img.shields.io/github/license/Brujo2020/open-sdd)](https://github.com/Brujo2020/open-sdd/blob/main/LICENSE)
[![CI — Linux + Windows](https://img.shields.io/github/actions/workflow/status/Brujo2020/open-sdd/gates.yml?branch=main)](https://github.com/Brujo2020/open-sdd/actions/workflows/gates.yml)

<!-- pendiente de publicar: descomenta cuando v3.0.2 esté en el registro.
[![npm version](https://img.shields.io/npm/v/@brujo2020/open-sdd)](https://www.npmjs.com/package/@brujo2020/open-sdd)
[![install size](https://packagephobia.com/badge?p=@brujo2020/open-sdd)](https://packagephobia.com/result?p=@brujo2020/open-sdd)
-->

> El badge de CI es real y hoy está en rojo sobre `main`: mira el run para ver el job que falla. Las
> tres aserciones preexistentes de modo POSIX del job `windows` están documentadas al principio de
> [`.github/workflows/gates.yml`](.github/workflows/gates.yml).

[English](README.md) · **Español**

**Documentación:** [Demo de 60 segundos](docs/guides/quickstart-60s.md) ·
[Instalación](docs/INSTALL.md) · [Proyectos existentes](docs/guides/existing-projects.md) ·
[Actualización](docs/guides/upgrade.md) · [Integraciones](docs/guides/integrations.md) ·
[Migrar desde](docs/guides/migrate-from.md) · [Mediciones](docs/MEASUREMENTS.md) ·
[Alineación con el paper](docs/PAPER-ALIGNMENT.md)

> La trazabilidad completa de la arquitectura del paper sobre este código —incluido lo que **no**
> está implementado— está en **[docs/PAPER-ALIGNMENT.md](docs/PAPER-ALIGNMENT.md)**.

---

## Empieza aquí

Ejecuta el CLI **sin argumentos** dentro de un repositorio. Esa es la única puerta: inspecciona el
repositorio y muestra el **score SDD** compuesto (0–100 sobre siete comprobaciones que ya existen), la
**fase** actual (1 Especificar · 2 Implementar · 3 Verificar) y la **única acción siguiente**, con una
línea de por qué:

```bash
open-sdd
# SDD 93% · Fase 2 · Implementar · constitución 100% · EARS 100% · trazabilidad 100% ·
# evidencia 53% · contratos 100% · gates OK (C1, C2, las del nivel declarado) · alineación 100% ·
# siguiente: open-sdd impl brownfield-support
# Por qué: la especificación está sana y quedan tareas sin evidencia capturada.
```

Es de solo lectura y nunca pregunta. Un componente que el CLI no pudo inspeccionar se lista bajo
`sin medir:` y su peso queda **excluido del score** en lugar de contarse como cero, así que el número
nunca afirma más de lo que se midió. `status` es el mismo estado como panel completo; `status --check`
añade el veredicto constitucional y sale `1` con un hallazgo de severidad error; `status --quiet`
colapsa el panel a una línea para un hook de commit.

Los **asistentes bajo demanda** aparecen donde un comando ya encontró algo: un requisito EARS ambiguo,
un marcador `{{…}}` sin rellenar o una constitución ausente producen una propuesta lista para pegar o
una pregunta explícita —nunca una plantilla con huecos— y jamás cambian el veredicto del comando.

---

## Demo de 60 segundos

Un repositorio desechable, cuatro incoherencias reales y el CLI diciéndote cuáles son. Sin red, sin
`npm install`, sin escribir fuera de un directorio temporal:

```bash
git clone https://github.com/Brujo2020/open-sdd
cd open-sdd
npm --prefix tools/open-sdd ci
npm --prefix tools/open-sdd run build
sh scripts/demo-60s.sh
```

El script crea un repo temporal con una spec real (`.sdd/specs/payments/`), inyecta un requisito de
la delta sin ninguna tarea que lo implemente, una tarea marcada como completa sin la línea
`_Evidence:`, un marcador de plantilla `{{REQ-AREA-002}}` sin rellenar y un contrato declarado que no
existe; después ejecuta el CLI **fijado** —`tools/open-sdd/dist/cli.js` de este checkout, nunca el
`open-sdd` global— y muestra tres transcripciones: `status` (fase, trazabilidad, evidencia),
`delta validate` (requisito sin tarea, marcador sin rellenar) y `gates run` (la cadena Zero-Trust y
su veredicto).

Forma real de la salida (recortada):

```text
Specification: payments — Phase: initialized · tríada completa · trazabilidad 0/1 · evidencia 0/1 tarea(s) completada(s)
Contratos de payments — declarados por la delta que no existen: test/ledger.test.ts
…
Trazabilidad: 1/2 requisito(s) de la delta con tarea (50%); sin tarea: REQ-PAY-011; marcador(es) de plantilla sin rellenar (UNFILLED_REQUIREMENT_PLACEHOLDER, no es un id inexistente): T2→{{REQ-AREA-002}}.
…
  C3   Evidence Validation                        fail
  C6   Claims Integrity (Doc vs Code)             fail
  La cadena NO pasa

Veredicto de la demo (el script falla si el motor no ve alguno):
  DETECTADO requisito sin tarea (REQ-PAY-011)
  DETECTADO placeholder {{...}} sin rellenar (T2)
  DETECTADO tarea completada sin evidencia (T1)
  DETECTADO contrato declarado que no existe
  DETECTADO la cadena NO pasa (score del gate)
  DETECTADO la cadena sale con código 1 (no-cero)
```

Sale con código distinto de cero si el motor no detecta alguna de ellas: una demo que no puede fallar
es marketing, no una demo. Guía completa:
**[docs/guides/quickstart-60s.md](docs/guides/quickstart-60s.md)**.

En tu propio repositorio, los mismos tres comandos (sustituye solo la ruta del clon):

```bash
cd /ruta/a/tu/repositorio
node /ruta/a/open-sdd/tools/open-sdd/dist/cli.js status
node /ruta/a/open-sdd/tools/open-sdd/dist/cli.js delta validate <feature>
node /ruta/a/open-sdd/tools/open-sdd/dist/cli.js gates run
```

O en un contenedor, sin instalar Node:

```bash
docker build -t open-sdd .
docker run --rm -v "$PWD:/work" open-sdd status
```

Los números medidos —por clase, con el comando exacto y la versión de la herramienta— están en
**[docs/MEASUREMENTS.md](docs/MEASUREMENTS.md)**: son cifras de honestidad sobre repositorios
**sintéticos**, no datos de campo de equipos reales.

---

## ¿Por qué no spec-kit o Kiro?

Los dos son buenos en lo suyo y merecen usarse. Según su documentación pública:

- **spec-kit** tiene un sitio de documentación, una superficie de instalación e integraciones mucho
  más amplia y una curva de aprendizaje más suave; su flujo se entrega como prompts y skills que lee
  tu agente.
- **Kiro** integra el desarrollo spec-driven en su propio IDE. Esa integración es más fluida que
  cualquier cosa que ship este repositorio, y si vives en ese IDE es la mejor experiencia de
  autoría.

Lo que aquí es distinto, y verificable en este repositorio:

- **El veredicto es ejecutable.** `open-sdd gates run` decide pasa o no pasa y sale con código
  distinto de cero, y un control declarado pero no implementado se reporta como declarado en lugar
  de contarse como verde (mira las brechas en [docs/PAPER-ALIGNMENT.md](docs/PAPER-ALIGNMENT.md)).
- **El código existente es el punto de entrada, no un añadido.** La delta es la unidad de
  especificación y la constitución es el pivote contra el que se valida cada spec —los conceptos que
  nombra el issue #1436 de spec-kit, reimplementados sobre este motor (la brecha G-21 dice
  exactamente dónde la cobertura es más estrecha).
- **Sin lock-in de proveedor ni de modelo.** Un CLI con licencia MIT escribe skills para 18
  definiciones de agente (8 basadas en skills), y no ship ningún backend de modelo.

Lo que **no** se afirma: paridad de ecosistema, de pulido o de adopción. Esas son hoy las fortalezas
de spec-kit y de Kiro. Esto es una comparación cualitativa, no un benchmark. Si vienes de Kiro,
spec-kit o cc-sdd, [Migrar desde Kiro, spec-kit y cc-sdd](docs/guides/migrate-from.md) mapea sus
artefactos y layouts sobre este, y [Integraciones](docs/guides/integrations.md) es la matriz de
instalación por agente.

---

## Adoptar open-sdd y migrar desde otra herramienta SDD

`integrate` es la superficie de adopción comprobada por máquina, e `import` absorbe los artefactos de
un incumbente. Ambos son **planes primero**: no se escribe nada sin `--write`, y ninguno sobrescribe
un fichero.

```bash
open-sdd integrate --list            # la matriz: 10 anfitriones, layout de skills, invocación, MCP
open-sdd integrate cursor            # detecta o nombra un anfitrión; imprime su invocación exacta
open-sdd integrate cursor --write    # instala las skills y registra el servidor MCP (idempotente)
open-sdd import spec-kit             # planifica el mapeo de .specify/** a .sdd/**
open-sdd import kiro --write         # copia steering + la tríada; nunca sobrescribe un fichero
```

`integrate` lee `tools/open-sdd/src/core/integrations.ts`: una fila por anfitrión con la sintaxis
exacta de invocación (`/sdd-brownfield`, `$sdd-brownfield`, `@sdd-brownfield`, …), la ruta del archivo
MCP por SO y el snippet que registra el servidor stdio. `verified` es un campo de **evidencia** —una
fila no confirmada se imprime como **NO VERIFICADA** y `--write` se niega a tocarla, así que pegas y
compruebas el snippet tú—. `import` es un **mapeo, no una migración**: cada artefacto reconocido que
no se puede mapear se reporta como `skip` con su motivo, los requisitos importados no se validan como
EARS, y un fichero que ya existe nunca se sobrescribe. Guía por anfitrión:
[docs/guides/integrations.md](docs/guides/integrations.md); mapeo artefacto a artefacto:
[docs/guides/migrate-from.md](docs/guides/migrate-from.md).

---

## Instalación

La versión corta está aquí abajo. Todas las rutas, los prerequisitos, lo que escribe el instalador y
cómo verificarlo están en **[docs/INSTALL.md](docs/INSTALL.md)**.

### Instalación sin placeholders

Estos comandos se copian y se pegan tal cual desde el clon: no hay que sustituir ninguna ruta ni
ningún marcador. Instalan dependencias, compilan el CLI y lo dejan disponible en el `PATH`:

```bash
npm --prefix tools/open-sdd ci
npm --prefix tools/open-sdd run build
npm run install:global
open-sdd --version
```

### Desde un clon (los comandos de build y CLI de abajo se verificaron así)

```bash
git clone https://github.com/Brujo2020/open-sdd
cd open-sdd
npm --prefix tools/open-sdd install    # instala las dependencias de desarrollo del CLI
npm --prefix tools/open-sdd run build  # compila a tools/open-sdd/dist/
node tools/open-sdd/dist/cli.js --help
```

`tools/open-sdd/dist/` está presente y versionado, así que un checkout también puede ejecutar el CLI
sin compilar antes.

### Instalar las skills en un proyecto

Ejecuta el CLI **dentro del repositorio de destino**, o usa el helper `install.sh`, que recibe el
destino como primer argumento:

```bash
# En el repo de destino (skills de Claude Code, sin preguntas):
node /ruta/a/open-sdd/tools/open-sdd/dist/cli.js --claude-skills -y

# O desde el clon de open-sdd:
bash install.sh /ruta/a/tu/repo --cursor-skills -y
```

El helper compila el CLI la primera vez e instala artefactos bajo `<repo>/.sdd/` más el directorio de
skills del agente seleccionado.

### CLI global

```bash
npm run install:global          # compila e instala este checkout de forma global
open-sdd gates chain            # uno de: open-sdd, sdd-open, sdd
```

### Paquete publicado

El paquete npm es **`@brujo2020/open-sdd`**. El registro lleva hoy la **v2.0.0**, que es una
herramienta más antigua y con comportamiento distinto de la **v3.0.2** que documenta este README —y
la v3.0.2 **todavía no está publicada**. Dos hechos que la documentación tiene que decir sin rodeos:

- El nombre sin scope `open-sdd` **no** es este proyecto (no existe en el registro), así que
  `npx open-sdd@latest` falla. El nombre con scope es el único correcto.
- `npx @brujo2020/open-sdd@latest` **sí se ejecuta hoy**, pero te da el binario publicado v2.0.0, no
  este checkout. Hasta que se publique la v3.0.2, usa una de las dos rutas que instalan esta versión:

```bash
bash install.sh /ruta/a/tu/repo               # desde un clon: instala en un repositorio de destino
npm run install:global                        # desde un clon: deja open-sdd en tu PATH
```

Cuando se publique la v3.0.2, el mismo punto de entrada estará disponible sin clonar:

```bash
npx @brujo2020/open-sdd@latest --cursor-skills -y   # pendiente de publicar
```

### Banderas del CLI

| Bandera | Significado |
|---|---|
| `--agent <id>` | Selecciona un agente (ver la tabla de abajo) |
| `--<alias>` | Banderas de alias de agente, p. ej. `--claude-skills`, `--cursor-skills`, `--antigravity` |
| `--lang <code>` | `ja en zh-TW zh es pt de fr ru it ko ar el` |
| `--os <auto\|mac\|windows\|linux>` | SO destino (por defecto `auto`) |
| `--sdd-dir <path>` | Raíz SDD (por defecto `.sdd` o `.kiro`); `--kiro-dir` es un alias |
| `--overwrite <prompt\|skip\|force>` | Política de sobrescritura (por defecto `prompt`) |
| `--backup[=<dir>]` | Hace copia de seguridad antes de sobrescribir |
| `--profile <full\|minimal>` | Perfil de plantillas (por defecto `full`) |
| `--manifest <path>` | Planifica desde un manifiesto explícito |
| `--dry-run` | Imprime el plan y no escribe nada |
| `--yes`, `-y` | Omite las preguntas (`prompt` → `force`) |

En entornos no interactivos, `prompt` cae a `skip`.

---

## El flujo de trabajo, en el agente

Después de instalar, usa las skills desde el chat de tu agente:

| Comando | Qué hace |
|---|---|
| `/sdd-help` | Guía interactiva, chuleta y ejemplos |
| `/sdd-getspecs [focus]` | Brownfield: reingenieriza steering + semillas de spec editables |
| `/sdd-brownfield` | Gobernanza brownfield: recon, constitución, delta, impacto y rigor (los 5 pasos) |
| `/sdd-discovery "idea"` | Encamina trabajo nuevo; escribe `brief.md` + `roadmap.md` |
| `/sdd-spec-quick <feature> [--auto]` | Requisitos → diseño → tareas en una pasada |
| `/sdd-impl <feature> [tasks] [--review required\|inline\|off]` | Implementación autónoma o dirigida |
| `/sdd-validate-impl <feature>` | Verificación de nivel de feature independiente |
| `/sdd-audit <feature> [--regulatory]` | Informe de drift; EU AI Act / NIST RMF cuando se pide |
| `/sdd-spec-status <feature>` | Progreso y próximas acciones |

La ruta paso a paso es `/sdd-steering` → `/sdd-spec-init` → `/sdd-spec-requirements` →
`/sdd-validate-gap` → `/sdd-spec-design` → `/sdd-validate-design` → `/sdd-spec-tasks` → `/sdd-impl`.

---

## Brownfield: gobernar un código que ya existe

Cuando el código ya existe, el código existente es la fuente de verdad de facto y la unidad de
especificación no es el sistema sino la **delta**: el artefacto que describe solo lo que cambia. Tres
mecanismos implementan eso, todos en la consola `open-sdd`. La ruta completa, con lo que lee, lo que
nunca toca y la lista honesta de lo que no hace, está en
**[docs/guides/existing-projects.md](docs/guides/existing-projects.md)**.

### Brownfield en 5 pasos

La regla que manda: **el código existente es la fuente de verdad de facto: no reinventes la
arquitectura, gobiérnala.** La ruta corta, en orden, con los mnemónicos del *Manual Maestro SDD
v3.0* (**ADSR** para la delta, **EARS** para la forma comprobable del requisito, **EGTAV** para las
cinco capas: Especificación, Generación, Tareas, Artefactos, Validación):

| Paso | Comando | Qué produce |
|---|---|---|
| 1. Reconocer | `open-sdd brownfield bootstrap .` | stack, módulos, evidencia y el plan ordenado de pasos |
| 2. Anclar | `open-sdd brownfield constitution . --write` | `.sdd/steering/constitution.md` descriptiva, con evidencia |
| 3. Describir el cambio | `open-sdd delta init <feature> "..."` → `open-sdd delta validate <feature>` | la delta ADSR: el contrato del cambio, no la spec de todo el sistema |
| 4. Comprobar | `open-sdd status --check`, `brownfield impact\|contracts\|reuse`, `govern rigor` | pivote constitucional, impacto, oráculo de regresión, reutilización |
| 5. Entregar | `open-sdd status` | la evidencia en las tareas, los gates del nivel declarado y un único panel |

El detalle está en el skill **`/sdd-brownfield`**
(`tools/open-sdd/templates/agents/*/skills/sdd-brownfield/SKILL.md`) y en la guía de 10 minutos
[docs/guides/brownfield-quickstart.md](docs/guides/brownfield-quickstart.md). La constitución es el
**pivote**: cada spec se valida contra ella con `open-sdd status --check`.

### 1. La delta es el contrato del cambio

Una delta tiene cuatro secciones —`ADDED`, `MODIFIED`, `REMOVED`, `RENAMED` (ADSR)— y cada entrada
lleva un identificador acotado a la delta, `REQ-<AREA>-<NNN>`, en lugar de un id para todo el
sistema, que es lo que mantiene finita la obligación.

| Sección | Obligación extra |
|---|---|
| `ADDED` | — |
| `MODIFIED` | `previous` (el comportamiento sustituido); contratos recomendados |
| `REMOVED` | `previous` + `rationale` + `contracts` (los tres obligatorios) |
| `RENAMED` | `previous` obligatorio |

Cada entrada declara además un estado de estrangulamiento (`legacy → both → new`), de modo que mover
una pieza del sistema viejo al nuevo es progreso visible en lugar de una reescritura implícita.

```bash
open-sdd delta init <feature> "qué cambia"      # genera .sdd/specs/<feature>/delta.md
open-sdd delta validate <feature>               # ids, EARS, targets, obligaciones ADSR, trazabilidad
open-sdd delta status <feature>                 # recuentos, progreso de estrangulamiento, trazabilidad
```

Tres informes respaldan el cambio antes de escribirlo. `brownfield contracts <feature> [--verify]`
convierte los tests declarados por la delta en el oráculo de regresión: lista qué tests protegen los
ficheros cambiados, nombra los ficheros cambiados que **ningún** contrato cubre y, con `--verify`,
ejecuta el comando de test —código de salida 0 con un contrato declarado ausente no es un aprobado.
`brownfield impact <feature>` reporta el conjunto alcanzable, la superficie de API tocada y los
cambios de ruptura; `brownfield reuse <feature>` reporta los símbolos que una búsqueda
reuse-first habría encontrado primero.

### 2. La constitución reversa

`brownfield constitution` lee el repositorio y emite una constitución **descriptiva**: los principios
que el código ya cumple, cada uno con la evidencia de que los cumple, más el stack declarado como
hecho establecido. Una práctica deseada pero ausente se emite como **enmienda propuesta**, nunca como
un hecho, y un principio descriptivo sin evidencia es un error de validación.

```bash
open-sdd brownfield survey .                    # qué es el proyecto: stack, tooling, módulos, evidencia
open-sdd brownfield constitution . --write      # escribe .sdd/steering/constitution.md
```

### 3. Niveles de exigencia (la escalera)

Los tres niveles de rigor SDD son una **escalera acumulativa**: cada nivel solo *añade* exigencias y
gates, y una constitución válida es obligatoria en **todos** los niveles, porque un veredicto
bloqueante tiene que poder citar una autoridad. El nivel por defecto es **Spec-First**, y es fluido a
propósito: ejecuta los dos gates que nunca puedes auto-autorizar, no la auditoría completa.

| Nivel | Qué añade | Gates activos |
|---|---|---|
| **Spec-First** (por defecto, fluido) | Una spec de requisitos en forma EARS comprobable y una constitución válida. Nada más: sin ligado de evidencia, sin detección de drift, sin contratos, sin regeneración. | C1, C2 |
| **Spec-Anchored** | + una spec viva, la delta brownfield, trazabilidad requisito→tarea, ligado de evidencia y detección de drift en cada cambio. | C1, C2, C3, C6 |
| **Spec-as-Source** | + contratos de ejecución declarados y regeneración desde la spec como mecanismo de reparación. | C1, C2, C3, C4, C5, C6 |

C2 (secretos y comandos destructivos) está activo en todos los niveles **a propósito**: es el
subconjunto duro que nunca se auto-autoriza, así que bajar el rigor no puede volver aceptable una
credencial commiteada.

**Cómo subir el nivel:** decláralo en `.sdd/settings/rigor.json` con el nivel y un motivo no vacío
(una elección de rigor sin motivo declarado no es auditable, y un fichero malformado se rechaza en
lugar de degradarse en silencio). El campo opcional `gates` sobrescribe qué checks corren: puede
**estrechar** la lista, pero un id de gate desconocido se **rechaza** en lugar de ignorarse, así que
una errata no puede reducir en silencio los checks que un proyecto cree estar ejecutando.

```bash
open-sdd govern rigor            # compacto: nivel + gates activos + qué exige
open-sdd govern rigor --verbose  # la tabla completa de niveles, el motivo y cada hallazgo
open-sdd govern rigor --gates    # la tabla de la escalera: qué añade cada nivel y sus gates
open-sdd govern rigor --select   # recomienda un nivel desde la tabla de decisión
```

El reconocimiento es consciente de workspaces: en este repositorio `brownfield survey .` reporta
TypeScript / npm / tsc / Vitest y 9 módulos, no el «JavaScript, no tests detected» que reportaba
cuando el código vivía en un workspace anidado.

---

## Agentes anfitriones soportados

La lista autoritativa es `tools/open-sdd/src/agents/registry.ts` (`agentDefinitions`). Ocho variantes
se basan en skills y llevan la suite completa de 21 skills.

| Agente | id de `--agent` | Banderas alias | Instala en |
|---|---|---|---|
| Claude Code Skills | `claude-code-skills` | `--claude-code-skills`, `--claude-skills` | `.claude/skills` |
| Claude Code | `claude-code` | `--claude-code`, `--claude` | `.claude/commands/sdd` |
| Claude Code Agents | `claude-code-agent` | `--claude-code-agent`, `--claude-agent` | `.claude/commands/sdd` + `.claude/agents/sdd` |
| Codex Skills | `codex-skills` | `--codex-skills` | `.agents/skills` |
| Cursor Skills | `cursor-skills` | `--cursor-skills` | `.cursor/skills` |
| Cursor IDE | `cursor` | `--cursor` | `.cursor/commands/sdd` |
| GitHub Copilot Skills | `github-copilot-skills` | `--copilot-skills`, `--github-copilot-skills` | `.github/skills` |
| GitHub Copilot | `github-copilot` | `--copilot`, `--github-copilot` | `.github/prompts` |
| Gemini CLI Skills | `gemini-cli-skills` | `--gemini-cli-skills`, `--gemini-skills` | `.gemini/skills` |
| Gemini CLI | `gemini-cli` | `--gemini-cli`, `--gemini` | `.gemini/commands/sdd` |
| Windsurf Skills | `windsurf-skills` | `--windsurf-skills` | `.windsurf/skills` |
| Windsurf IDE | `windsurf` | `--windsurf` | `.windsurf/workflows` |
| OpenCode Skills | `opencode-skills` | `--opencode-skills` | `.opencode/skills` |
| OpenCode | `opencode` | `--opencode` | `.opencode/commands` |
| OpenCode Agents | `opencode-agent` | `--opencode-agent` | `.opencode/commands` |
| Antigravity Skills | `antigravity-skills` | `--antigravity-skills`, `--antigravity` | `.agent/skills` |
| Qwen Code | `qwen-code` | `--qwen-code`, `--qwen` | `.qwen/commands/sdd` |
| Codex CLI (prompts) | `codex` | `--codex`, `--codex-cli` | **obsoleto** — el CLI lo rechaza y apunta a `--codex-skills` |

La ruta de instalación de arriba es donde el CLI escribe **en tu proyecto**. Las plantillas que ship
este repositorio viven bajo `tools/open-sdd/templates/agents/<agent>/`.

---

## Perfiles de gobernanza

Hay **dos ejes de perfil distintos**, y no son intercambiables.

### 1. Qué bloquea — `.sdd/settings/governance.json`

Verificado en `tools/open-sdd/src/core/governance.ts` (`governanceProfiles`). Por defecto, `solo`.

| `profile` | Qué bloquea | Uso previsto |
|---|---|---|
| `solo` | Nada. Los checks corren y reportan. | Construir; quieres la señal, no la fricción. |
| `team` | Código escrito sin una spec aprobada. | Repositorio compartido. |
| `enterprise` | Todo (modo estricto, todos los invariantes críticos). | Entornos auditados. |

Existen tres checks; el perfil decide cuáles detienen una ejecución:
`spec_contract_present`, `boundary_integrity`, `verification_proofs_pass`. Los
`critical_invariants` explícitos sobrescriben el perfil; los ids desconocidos se descartan en lugar de
confiarse. Un check que el perfil ignora igualmente reporta. Ver
[docs/guides/governance-profiles.md](docs/guides/governance-profiles.md).

### 2. Qué controles Zero-Trust se declaran — `gates chain --profile`

Verificado en `tools/open-sdd/src/core/gateCatalog.ts` (`ChainProfile`, `PROFILE_MANDATED`). El núcleo
C1–C7 es constante; la capa activable es función del perfil y de las señales del repositorio.

| `--profile` | Declarados | Ejecutados | Vacíos | Añade |
|---|---|---|---|---|
| `solo` (por defecto) | 7 | 6 | 1 (C7) | — |
| `team` | 9 | 8 | 1 | O1, O5 |
| `regulated` | 12 | 11 | 1 | O1, O2, O3, O4, O5 (y `gates run` usa postura estricta) |

> Los nombres `enterprise` y `regulated` pertenecen a ejes distintos; `--profile enterprise` no es un
> perfil de cadena válido. Esta divergencia está registrada como brecha G-08 en
> [docs/PAPER-ALIGNMENT.md](docs/PAPER-ALIGNMENT.md).

---

## La consola Zero-Trust

Todos los comandos son casi siempre de lectura, deterministas y seguros de ejecutar desde la raíz del
repositorio. Salen con `0` salvo que se diga lo contrario.

| Comando | Qué imprime |
|---|---|
| `gates chain [--profile solo\|team\|regulated]` | La cadena resuelta, los recuentos declarado/ejecutado/vacío y las señales del repositorio que activaron los opt-in |
| `gates crosswalk` | Check implementado → gate lógico (G1–G21), más el residuo calculado por resta |
| `gates list` | Los 21 gates lógicos con tier, check y estado |
| `gates enforcement` | Niveles de enforcement A–D, el techo de escritura por herramienta y el aviso de fail-open del centinela |
| `gates run [ids…]` | Ejecuta la cadena resuelta (o controles nombrados). Sale `1` si la cadena no pasa |
| `govern invariants` | Invariantes I1–I6 y la inspección que decide cada uno |
| `govern conformance` | Nivel de conformidad C0–C3 con evidencia por invariante |
| `govern hitl` | Los umbrales cuantificados de Human-in-the-Loop |
| `govern discipline` | Propiedades decidibles del §9.7 (presupuesto de diff, contención de alcance) sobre el diff de trabajo |
| `floor status` / `floor install` | Si el suelo de enforcement propio (hook de commit + matriz de gates de PR) está instalado, e instalarlo en un proyecto destino |
| `govern rigor` | El nivel de rigor declarado y sus gates activos; `--select` recomienda un nivel, `--gates` imprime la escalera, `--verbose` añade cada hallazgo |
| `govern appeal` | Recibos de relajación y recalibración de la tasa de override |
| `govern meta-eval` | Piloto de κ de Cohen, el suelo de Landis–Koch y la `n` preregistrada |
| `govern budget` | Líneas de sobrecarga de gobernanza, el techo del 30 %, definiciones de métricas, enrutado T0–T3 |
| `assure threats` | OWASP Agentic → MITRE ATLAS → gates primarios; crosswalk regulatorio; la frontera de préstamo Zero-Trust |
| `assure lab` | Los cinco bancos de risk-lab y los umbrales de refutación preregistrados |
| `assure claims` | Los cinco estados de claim y el inventario medido/construido/propuesto; `assure claims --verify` ejecuta `docs/claims/paper-claims.yaml` y decide cada claim por código de salida (sale `1` solo con `broken`) |
| `assure skills` | Clases de skill, la regla dura de MCP y la escalera de promoción |
| `assure memory` | Malla de memoria, pipeline de destilación, sonda anti-envenenamiento |
| `waves <feature>` | Plan de olas transaccionales con los comandos git que lo materializarían (necesita `.sdd/specs/<feature>/tasks.md`) |
| `brownfield survey [target]` | Qué es el proyecto existente: stack, tooling, fronteras de módulo y la evidencia de cada una |
| `brownfield constitution [target] [--write]` | La constitución descriptiva (principios que el código cumple + enmiendas propuestas); `--write` la guarda en `.sdd/steering/constitution.md` |
| `delta init\|validate\|status\|render\|merge [--write] <feature>` | El contrato del cambio: generar ADSR, validar ids/EARS/contratos/trazabilidad, reportar recuentos y estrangulamiento, y fusionar la delta de vuelta en el `requirements.md` base (todo o nada) |
| `brownfield impact\|contracts\|reuse <feature>` | Análisis del cambio pendiente: conjunto alcanzable y cambios de ruptura, el oráculo de regresión (`--verify` ejecuta el comando de test), candidatos reuse-first |
| `brownfield bootstrap [target] [--focus "…"] [--write]` | Una sola entrada para un repositorio existente: el mapa de módulos, dónde va el código nuevo y el plan ordenado; `--write` escribe el documento de inteligencia, la constitución y la semilla de delta del foco |
| `brownfield templates [--write]` | Plantillas adaptadas al stack observado, cada sustitución nombrando el fichero que la demuestra; el ciclo TDD rojo-verde aparece solo si se observa un runner de tests |
| `brownfield analyze [--base <ref>]` | Consistencia cruzada en una pasada (requisitos↔tareas, delta↔diff, pivote, contratos, fronteras); `notChecked` nombra lo que no pudo inspeccionar |
| `integrate [host] [--list\|--write\|--dry-run\|--json]` | La matriz de integración: layout de skills, invocación exacta en el chat, ruta y snippet de MCP por anfitrión; las filas no verificadas se imprimen y nunca se escriben |
| `import [kiro\|spec-kit\|cc-sdd] [--write\|--dry-run\|--json]` | Planifica (y opcionalmente aplica) el mapeo de los artefactos de un incumbente a `.sdd/`; las omisiones se nombran y los ficheros existentes nunca se sobrescriben |
| `audit bundle [--out <dir>] [--sarif <path>] [--profile <p>]` | El bundle de evidencia de auditoría —constitución, specs, gates, claims, alineación y rigor— con un sha256 por artefacto; sale `1` con un hallazgo bloqueante y `2` si no pudo ejecutarse |
| `audit sarif [--out <path>]` | El mismo veredicto como SARIF 2.1.0, con la forma validada antes de escribirlo |
| `context [feature] [--json]` | La cara de terminal del context pack de MCP: constitución, spec aplicable, mapa de módulos y rigor declarado en un solo objeto |
| `tour [--write]` | El primer recorrido guiado: ejecuta los comandos reales y se detiene en la decisión humana (ratificar una constitución nunca se automatiza) |
| `doctor` | Autodiagnóstico —Node, CLI, hook de commit y su portabilidad, rigor, constitución, specs, postura offline— cada uno con el comando que lo arregla |
| `mcp` | El servidor MCP por stdio (11 herramientas + recursos de solo lectura) que cualquier anfitrión MCP puede llamar |

Las variables de entorno que acepta la consola incluyen `SDD_FEATURE`, `SDD_COMPLEXITY`,
`SDD_RELAXATIONS`, `SDD_CYCLE_TOKENS`, `SDD_META_TOKENS`, `SDD_AUDIT_TOKENS`, `SDD_DISTILL_TOKENS`,
`SDD_C2_OVERRIDES`/`SDD_C2_BLOCKS`, `SDD_C3_OVERRIDES`/`SDD_C3_BLOCKS`.

### Comandos SDLC

| Comando | Qué hace |
|---|---|
| `status [feature] [--check] [--quiet] [--json]` | El panel único: constitución, specs, delta, contratos, alineación, rigor y el siguiente comando; `--check` añade el veredicto constitucional |
| `init <feature>` | Genera un directorio de spec |
| `getspecs [focus]` | Escaneo brownfield → steering + semillas de spec |
| `gap <feature>` | Análisis de brecha / radio de impacto |
| `impl <feature>` | Ejecutor de implementación |
| `verify <feature>` | Verificación de nivel de feature |
| `audit <feature>` | Informe de drift + trazabilidad; `audit bundle`/`audit sarif` producen el bundle de evidencia y el informe SARIF |
| `help [topic]` | Ayuda en el chat |

---

## Arquitectura de referencia

La consola es un puerto del plano de control del paper, no una re-descripción de él. Los mapas de
abajo dan la sección del paper y el símbolo que la implementa;
**[docs/PAPER-ALIGNMENT.md](docs/PAPER-ALIGNMENT.md)** es el informe de trazabilidad completo,
incluidas todas las brechas declaradas.

| Paper (§ / Tabla) | Este código | Símbolo |
|---|---|---|
| Invariantes I1–I6, conformidad C0–C3 (§5.1, §5.2, Tablas 17/18) | `src/core/invariants.ts` | `INVARIANTS`, `CONFORMITY_LEVELS`, `assessConformity` |
| 21 gates lógicos, cadena ejecutable, crosswalk, residuo (Apéndice A, Tablas 33–36) | `src/core/gateCatalog.ts` | `LOGICAL_GATES`, `EXECUTABLE_CHAIN`, `buildCrosswalk`, `computeResidue` |
| Resolución de la cadena desde catálogo + perfil + señales (§9.5) | `src/core/gateCatalog.ts` | `resolveGateChain`, `detectSignals` |
| Postura default-FAIL y el subconjunto duro (§9.2) | `src/core/enforcement.ts` | `applyDefaultFail`, `HARD_SUBSET` |
| Niveles de enforcement A–D y techos por herramienta (§6.3, Tabla 19) | `src/core/enforcement.ts` | `ENFORCEMENT_LEVELS`, `TOOL_ENFORCEMENT`, `resolveFloor`, `interpretSentinel` |
| Tríada Documental + cerrojo de evidencia (§4.5, I2) | `src/core/triad.ts` | `TRIAD`, `evaluateTriad`, `checkEvidenceLock` |
| Gramática EARS (§4.6, Tabla 12) | `src/core/ears.ts` | `EARS_TEMPLATES`, `validateEarsRequirement` |
| Ejecutor de gates (§9.2, §9.5, §8.4) | `src/core/gateRunner.ts` | `runGate`, `runChain`, `scanSecurity`, `checkSymbols` |
| Umbrales HIL y selección de rigor (§9.9, §4.8, §4.10, Tabla 25) | `src/core/hitl.ts` | `HITL_DEFAULTS`, `evaluateEscalations`, `selectRigorMode` |
| Canal de apelación + recibos de relajación (I6, §9.10) | `src/core/receipts.ts` | `makeReceipt`, `recalibrate`, `assessI6` |
| Protocolo META-EVAL (§7.3, §7.4) | `src/core/metaEval.ts` | `cohensKappa`, `checkJudgeIndependence`, `checkApprovalDrift` |
| Olas transaccionales (§7.2) | `src/core/waves.ts`, `src/core/scheduler.ts` | `resolveWave`, `checkScope`, `waveGitCommands`, `buildTaskDependencyWaves` |
| Malla de memoria, destilación y anti-envenenamiento (§11) | `src/core/memory.ts` | `MEMORY_MESH`, `decidePromotion`, `scanForInjection`, `applyDecay` |
| Skills como unidad de privilegio; Auto-Skill Factory (§6.4, §11.1, Tabla 28) | `src/core/skills.ts` | `SKILL_CLASSES`, `checkMcpPermissions`, `evaluateCandidate` |
| Registro de claims e inventario de estado de implementación (§9.6, §2.3) | `src/core/claims.ts`, `src/core/claimsRegistry.ts`, `docs/claims/paper-claims.yaml` | `CLAIM_STATUSES`, `evaluateClaim`, `IMPLEMENTATION_STATUSES`, `runClaimsRegistry` |
| Modelo de amenazas, crosswalk regulatorio, risk lab (§9.8, Apéndice D, §14.3, Tablas 24/31/39) | `src/core/assurance.ts` | `OWASP_AGENTIC_MAP`, `REGULATORY_MAP`, `RISK_LAB_BANKS`, `REFUTATION_THRESHOLDS` |
| Presupuesto de sobrecarga y telemetría (Apéndice B.4–B.6, §10.3) | `src/core/telemetry.ts` | `COST_LINES`, `evaluateGovernanceBudget`, `COMPLEXITY_TIERS`, `HARNESS_SELF_FAILURE` |
| Inversión brownfield (§12, Figura 9) | `src/core/reverseEngineering.ts` | `scanProject`, `bootstrapSteering`, `bootstrapSpecSeeds` |
| Superficie agnóstica — el servidor MCP (§6.4, Tabla 4; §9.5 G16/O2) | `src/mcp/server.ts`, `src/mcp/tools.ts`, `src/core/contextPack.ts` | `runMcpServer`, `listToolDescriptors`, `callTool`, `listResources`, `readResource`, `buildContextPack` |
| Superficie de adopción como dato comprobado (issue #1436 de spec-kit) | `src/core/integrations.ts`, `src/core/importers.ts` | `HOST_INTEGRATIONS`, `detectIntegration`, `mcpRegistration`, `planImport`, `applyImport` |
| Un número, una fase, una acción (*Manual Maestro* EGTAV; §9.6) | `src/core/sddScore.ts`, `src/core/assistants.ts` | `computeSddScore`, `renderScoreFooter`, `assist`, `renderAssist` |
| El asistente EARS y las plantillas adaptadas al stack (§4.6; issue #1436 de spec-kit) | `src/core/earsAssistant.ts`, `src/core/templateAdaptation.ts`, `src/core/consistency.ts` | `analyseEars`, `earsEvidencePack`, `adaptTemplates`, `checkConsistency` |
| El trinquete constitucional y las excepciones caducables (CSDD §3.4; invariantes I1/I6) | `src/core/ratchet.ts`, `src/core/securityAllowlist.ts` | `runAdhesionRatchet`, `expiredWaivers`, `applySecurityAllowlist` |
| Bundle de evidencia + SARIF (§9.6; CSDD §3.3) | `src/cli/commands/audit.ts`, `action.yml` | `collectEvidence`, `writeBundle`, `buildSarifLog`, `validateSarifShape`, `AUDIT_EXIT_CODES` |
| La demo, el bench sintético y las mediciones (disciplina del §14.3) | `scripts/demo-60s.sh`, `bench/harness.mjs`, `docs/MEASUREMENTS.md` | comando reproducible; inyectado/detectado/perdido por clase |

### Lo que este puerto **no** hace

Se dice aquí para que la sección de referencia no se lea como una afirmación de completitud:

- **El prototipo del paper (SteelHarness) no está publicado.** Sus cifras medidas —κ = 0.86 (n=15),
  C4 FPR 20.0 % (3/15), el barrido de 2.1–2.2 s, los recuentos de cadena 7/9/12, el piloto de
  −53 % de tokens— son propiedades de ese prototipo. **No** son medidas de este repositorio, y la
  consola etiqueta las que reproduce como el piloto del paper.
- **No ship ningún backend de modelo.** C5 (alineación de intención) reporta `mode=degraded` y no es
  evidencia; META-EVAL es un modelo computacional, no un juez en ejecución.
- **C7/Karpathy es vacío** (`inspects: false`) y se reporta como activación sin medición.
- **Las propiedades decidibles del §9.7 están implementadas pero no cableadas a un gate.**
- **Sin calibración de gates, sin corpus etiquetado, sin tabla delta ON/OFF.** El paper tampoco
  publica una tabla ON/OFF, así que aquí no se inventa ninguna.
- **El suelo de commit/merge está instalado, pero el nivel A no está verificado.** El hook de
  pre-commit (nivel B) y la matriz de gates de pull request (nivel C) existen y se ejercitan;
  `resolveFloor` sigue siendo un argumento de propiedad, y ningún centinela de comportamiento ha
  verificado el bloqueo en tiempo de escritura en ningún anfitrión, así que el nivel A es un techo y
  no una garantía. `git commit --no-verify` salta el nivel B y ese salto no queda registrado.
- **Cuatro de las diez integraciones MCP no están verificadas.** Copilot, OpenCode, Zed y Antigravity
  se publican con `verified: false`: `integrate` imprime el snippet como **NO VERIFICADA** y `--write`
  se niega a tocar la configuración de ese anfitrión (G-24).
- **`import` es un mapeo, no una migración.** El `spec.json` de Kiro/cc-sdd, las skills de cc-sdd, las
  plantillas/scripts de spec-kit y los settings que no parsean se omiten con un motivo, y los
  requisitos importados se copian tal cual —sin validar como EARS— (G-25).
- **El job de Windows está en rojo, y el hook de commit nunca corre allí.** El job `windows` de CI
  ejecuta la suite completa y falla en ella —el workflow nombra tres aserciones preexistentes de modo
  POSIX que espera como causa— y solo el job de Linux instala el hook de pre-commit, así que la puerta
  portable de Node nunca se ha ejecutado en Windows (G-26).
- **El contenedor se construye para una sola arquitectura.** `docker build` produce la arquitectura
  del builder; ningún job de CI construye ni publica una imagen multi-arquitectura (G-27).
- **Todavía no hay nada publicado en npm.** El registro solo lleva la v2.0.0 de `@brujo2020/open-sdd`,
  así que toda ruta de instalación de aquí es desde un clon hasta que salga la v3.0.2 (G-28).
- **Las mediciones son sintéticas.** `docs/MEASUREMENTS.md` registra 10/10 clases detectadas en
  repositorios que escribió este proyecto —autoconsistencia, no recall ni precisión de campo— (G-29).

Cada uno de estos es una brecha numerada (G-01 … G-29) con su cita del paper y su ubicación en el
código en [docs/PAPER-ALIGNMENT.md](docs/PAPER-ALIGNMENT.md).

---

## Suelo de enforcement (niveles B y C)

La garantía que esta herramienta puede dar desde el primer día es el **suelo de commit/merge**,
porque esas fronteras pertenecen a la organización y no a un proveedor. Ambas están instaladas aquí,
y se instalan en cualquier proyecto destino:

```bash
npm run hooks:install              # nivel B en este checkout (también corre solo con npm install)
open-sdd floor install . --ci      # nivel B + C en un proyecto destino
open-sdd floor status              # ¿está instalado el suelo? sale 1 cuando no lo está
```

El hook juzga el **índice preparado** (staged), no el árbol de trabajo, y ejecuta tres controles: C1
(tríada, advisory), C2 (secretos y comandos destructivos, bloqueante) y C3 (cerrojo de evidencia,
bloqueante cuando una tarea se marca completa sin su prueba capturada). Si el propio CLI falta, el
hook **falla cerrado** e imprime cómo arreglarlo. Los falsos positivos legítimos se declaran por
(path, patrón) con un motivo en `.sdd/settings/security-allowlist.json`, y cada ejecución reporta
cuántos hallazgos suprimió: una supresión nunca es silenciosa. `git commit --no-verify` también salta
el hook, y ese salto **no** queda registrado; la allow-list es el canal que una auditoría puede leer.

El nivel C es `.github/workflows/gates.yml` (`templates/hooks/open-sdd-gates.yml` para proyectos
destino): la cadena corre contra el diff del pull request vía `--base`, porque una ejecución de gates
que no inspecciona nada es activación sin medición.

---

## Estructura del repositorio

```
open-sdd/
├── tools/open-sdd/            fuente del CLI, plantillas, manifiestos
│   ├── src/core/            modelos de gobernanza (ver el mapa de arriba)
│   ├── src/mcp/             el servidor MCP por stdio (11 herramientas + recursos)
│   ├── src/agents/          registro de agentes (18 definiciones)
│   ├── src/cli/commands/    status, init, getspecs, gap, impl, verify, audit, paper, brownfield, tour
│   ├── templates/agents/    168 plantillas SKILL.md en 8 variantes de skills
│   ├── templates/hooks/     la puerta de commit portable y la matriz de gates de CI
│   └── dist/                CLI compilado (commiteado)
├── docs/
│   ├── PAPER-ALIGNMENT.md   informe de trazabilidad (paper → código → brechas)
│   ├── INSTALL.md           todas las rutas de instalación, verificadas
│   ├── QUICK-START.md       ruta de 5 minutos
│   ├── INSTALLATION.md      referencia de instalación heredada
│   ├── MEASUREMENTS.md      los números del bench sintético, con sus comandos
│   ├── claims/              paper-claims.yaml (registro §9.6)
│   └── guides/              flujo, gobernanza, brownfield, integraciones, actualización, git, skills
├── bench/                   el bench sintético de incoherencias
├── scripts/                 demo-60s.sh, instalador del hook, postinstall
├── action.yml               la frontera de merge como GitHub Action nativa
├── Dockerfile               la imagen de contenedor (una arquitectura)
├── .sdd/                    settings + plantillas (la memoria de proyecto vive aquí)
├── install.sh               instala los artefactos del CLI en un repo destino
└── package.json             bin: open-sdd, sdd-open, sdd
```

---

## Documentación

- **[docs/guides/quickstart-60s.md](docs/guides/quickstart-60s.md)** — la demo, paso a paso.
- **[docs/INSTALL.md](docs/INSTALL.md)** — todas las rutas de instalación, verificación y desinstalación.
- **[docs/guides/upgrade.md](docs/guides/upgrade.md)** — actualizar entre versiones y refrescar el gate.
- **[docs/guides/existing-projects.md](docs/guides/existing-projects.md)** — la ruta brownfield.
- **[docs/guides/integrations.md](docs/guides/integrations.md)** — la matriz de instalación por agente y cómo verificar o quitar cada instalación.
- **[docs/guides/migrate-from.md](docs/guides/migrate-from.md)** — migrar desde Kiro, spec-kit y cc-sdd.
- **[docs/QUICK-START.md](docs/QUICK-START.md)** — instalar y ejecutar en cinco minutos.
- **[docs/INSTALLATION.md](docs/INSTALLATION.md)** — la referencia de instalación heredada.
- **[docs/PAPER-ALIGNMENT.md](docs/PAPER-ALIGNMENT.md)** — trazabilidad paper→código y brechas.
- **[docs/MEASUREMENTS.md](docs/MEASUREMENTS.md)** — los números de honestidad, con sus comandos.
- **[docs/guides/governance-profiles.md](docs/guides/governance-profiles.md)** — qué bloquea, y cuándo.
- **[docs/guides/spec-driven.md](docs/guides/spec-driven.md)** — el flujo SDD de principio a fin.
- **[docs/guides/skill-reference.md](docs/guides/skill-reference.md)** — las 21 skills.
- **[docs/guides/git-workflow.md](docs/guides/git-workflow.md)** — automatización de ramas/commits.
- **[docs/guides/brownfield-getspecs.md](docs/guides/brownfield-getspecs.md)** — códigos existentes.
- **[docs/README.md](docs/README.md)** — índice de documentación.

## Licencia

MIT — ver [LICENSE](LICENSE).
