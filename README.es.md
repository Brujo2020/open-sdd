# open-sdd

`open-sdd` es la capa que hace verificable el «hecho» de un agente de código: gates ejecutables,
specs delta para el código que ya existe y una constitución que valida cada spec.

[![Licencia: MIT](https://img.shields.io/github/license/Brujo2020/open-sdd)](https://github.com/Brujo2020/open-sdd/blob/main/LICENSE)
[![CI — Linux + Windows](https://img.shields.io/github/actions/workflow/status/Brujo2020/open-sdd/gates.yml?branch=main)](https://github.com/Brujo2020/open-sdd/actions/workflows/gates.yml)

[English](README.md) · **Español**

## El problema

Los agentes de IA escriben código rápido, y su «ya está» es una afirmación que nadie comprueba.
Las herramientas spec-driven que solo usan prompts producen documentos, y un documento no rompe un
build. Esta herramienta convierte la afirmación en algo ejecutable: un gate decide pasa o no pasa, y
un control declarado pero no implementado se reporta como declarado en vez de contarse como verde.

## Instalación y los primeros 60 segundos

```bash
npx @brujo2020/open-sdd init . --write
```

Ejecútalo dentro de tu repositorio. Detecta el agente anfitrión, registra el nivel de exigencia en
`.sdd/settings/rigor.json` e instala el gate de commit (`.git/hooks/pre-commit`). Es plan-first: sin
`--write` solo imprime el plan, y nunca sobrescribe un archivo existente. Para instalar también las
skills del anfitrión, añade `--skills`; `open-sdd integrate <host> --write` instala las skills **y**
registra el servidor MCP (`--list` muestra los diez anfitriones; seis llevan un registro verificado).

Después, la única puerta. Sin argumentos, de solo lectura: imprime un score SDD de 0–100, la fase
actual y UNA acción siguiente, con una línea de por qué.

```bash
open-sdd                 # score SDD, fase y la única acción siguiente
open-sdd status          # el mismo estado como panel completo
open-sdd --help          # todos los comandos
```

Los mensajes de consola están hoy en español; `--lang en` traduce por completo solo
`open-sdd tour` y `open-sdd context`. Los comandos de arriba funcionan desde el paquete publicado. En
este checkout, sustituye `open-sdd` por `node tools/open-sdd/dist/cli.js`.

Opcional: la demo de 60 segundos, sin red, en un directorio temporal desechable.

```bash
git clone https://github.com/Brujo2020/open-sdd && cd open-sdd
bash scripts/demo-60s.sh
```

Inyecta cuatro incoherencias reales —un requisito sin trazabilidad, una tarea completada sin
evidencia, un marcador `{{…}}` sin rellenar, un contrato declarado que no existe— y sale con código
distinto de cero si la herramienta deja pasar alguna.

## Lo que obtienes

- **Un servidor MCP.** Un servidor stdio JSON-RPC con 11 herramientas y recursos de solo lectura,
  invocable desde cualquier anfitrión MCP moderno. Sin red, sin backend de modelo, sin claves de API.
- **Specs delta.** `ADDED` / `MODIFIED` / `REMOVED` / `RENAMED`, con ids `REQ-<AREA>-<NNN>` acotados
  a la delta, para que el contrato del cambio siga siendo finito.
- **Una constitución como pivote.** Cada spec se valida contra `.sdd/steering/constitution.md`;
  `brownfield constitution --draft` la propone y una persona la ratifica.
- **Una escalera de exigencia.** `spec-first` → `spec-anchored` → `spec-as-source`, fluida por
  defecto y acumulativa: cada paso solo añade gates, y una constitución válida es obligatoria en
  todos los niveles.
- **Un gate de commit y comprobaciones de PR.** Un hook de pre-commit sobre el índice preparado, y un
  workflow de pull request que ejecuta la cadena completa.
- **Un paquete de auditoría.** Un sha256 por artefacto más SARIF 2.1.0; sale con código distinto de
  cero ante un hallazgo bloqueante.
- **Asistentes bajo demanda.** Donde un comando ya encontró una brecha —un requisito EARS ambiguo, un
  marcador sin rellenar, una constitución ausente— propone un arreglo listo para pegar o formula una
  pregunta explícita.
- **Adopción brownfield.** `brownfield bootstrap` produce un mapa de módulos, un documento de
  inteligencia del código, una constitución reversa y candidatos de reutilización primero.
- **Importadores.** `import kiro | spec-kit | cc-sdd` mapea artefactos de herramientas anteriores a
  `.sdd/` y nombra cada omisión con su motivo.

## Cómo se compara

Cualitativo, a partir de la documentación pública de las alternativas. Esto **no es un benchmark**.

| | esta herramienta | spec-kit | Kiro | paquetes de skills solo-prompt |
|---|---|---|---|---|
| Naturaleza | CLI + motor MCP | toolkit de prompts/skills | SDD dentro de un IDE | prompts y skills |
| Integración con el anfitrión | servidor MCP; 18 definiciones de agente, 10 registros de anfitrión (6 verificados) | amplia superficie de instalación e integración | su propio IDE | el chat del anfitrión |
| Specs para código existente | specs delta + constitución reversa | flujo de specs; hay una extensión de bootstrap brownfield propuesta (#1436) | flujo de specs en el IDE | solo documentos |
| Enforcement | gates ejecutables, códigos de salida, hook de commit + checks de PR | prompts y revisión | flujo guiado por el IDE | ninguno |
| Evidencia / auditoría | paquete de auditoría, sha256 por artefacto, SARIF | los propios documentos | artefactos del IDE | ninguno |
| Sin red | sin red, sin backend de modelo | plantillas y scripts locales | producto IDE | depende del anfitrión |

spec-kit hace dos cosas que este repositorio no hace: un ecosistema y una superficie de integración
mucho más amplios, y una curva de aprendizaje más suave. La integración de Kiro con su IDE es más
pulida que cualquier cosa que se distribuya aquí. Si vives en cualquiera de los dos, son buenas
elecciones; no se reclama paridad de ecosistema, de pulido ni de adopción.
[Migrar desde Kiro, spec-kit y cc-sdd](docs/guides/migrate-from.md) mapea sus artefactos a los de
esta herramienta.

## Lo que todavía no hace

- **El descubrimiento de módulos es solo para Node.** Las raíces de workspace salen de
  `package.json`; los monorepos de Maven/Gradle, Go, Rust y Python devuelven un único módulo raíz en
  `brownfield bootstrap`.
- **El análisis de impacto tiene clases conocidas de falsos positivos.** `brownfield impact` lee el
  grafo de imports y la delta, y una comprobación con ese nivel de ruido puede entrenar a sus
  lectores a ignorarla.
- **Cuatro de los diez registros MCP no están verificados.** Copilot, OpenCode, Zed y Antigravity se
  distribuyen como no verificados: se imprime el fragmento y `--write` se niega a tocar su
  configuración.
- **El contenedor se construye para una sola arquitectura.** `docker build` produce la arquitectura
  del builder, y ningún job de CI construye ni publica una imagen multi-arquitectura.
- **Las mediciones son sintéticas.** `docs/MEASUREMENTS.md` registra 10/10 clases inyectadas
  detectadas en repositorios que escribió este proyecto —autoconsistencia, no recall ni precisión de
  campo. Las cifras κ/FPR/latencia del paper pertenecen a un prototipo no publicado y no son
  mediciones de este repositorio.
- **El suelo de commit está instalado, pero el nivel A no está verificado.** El hook y la matriz de PR
  existen y se ejecutan; ningún centinela de comportamiento ha verificado el bloqueo en tiempo de
  escritura en ningún anfitrión, y `git commit --no-verify` no se registra.

La lista completa de brechas (G-01 … G-29), cada una con su ubicación en el código, está en
[docs/PAPER-ALIGNMENT.md](docs/PAPER-ALIGNMENT.md).

## Documentación

[Instalación](docs/INSTALL.md) · [Inicio rápido (60 s)](docs/guides/quickstart-60s.md) ·
[Integraciones](docs/guides/integrations.md) · [Proyectos existentes](docs/guides/existing-projects.md) ·
[Migrar desde Kiro / spec-kit / cc-sdd](docs/guides/migrate-from.md) ·
[Mediciones](docs/MEASUREMENTS.md) · [Alineación con el paper y brechas](docs/PAPER-ALIGNMENT.md) ·
[English](README.md) · [Changelog](CHANGELOG.md)

## Licencia

MIT — consulta [LICENSE](LICENSE).
