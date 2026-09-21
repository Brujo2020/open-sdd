/**
 * Identidad del paquete — UNA fuente para el nombre, la versión y el comando de instalación.
 *
 * ── Por qué existe este archivo ────────────────────────────────────────────────────────────────
 * El CLI anunciaba el nombre SIN SCOPE con `@latest` en sus propios mensajes de runtime, pero ese
 * nombre no existe en npm (E404): el primer comando que un usuario copia del propio tool falla. El
 * nombre real vive en el `package.json` de la RAÍZ de la distribución (`@brujo2020/open-sdd`), así
 * que aquí se DERIVA de ahí en vez de escribirse a mano. Un nombre escrito a mano es un nombre que
 * envejece (W0/W1 de `docs/EVOLUTION-PLAN.md`).
 *
 * ── Resolución robusta ─────────────────────────────────────────────────────────────────────────
 * En el checkout: `tools/open-sdd/dist/cli/packageIdentity.js` → cuatro niveles arriba está la raíz
 * del repo. En el artefacto publicado: `<paquete>/tools/open-sdd/dist/cli/` → cuatro niveles arriba
 * está la raíz del paquete publicado, que es exactamente el manifiesto que lleva el nombre y la
 * versión publicados. `new URL('../../../../package.json', import.meta.url)` resuelve en ambos
 * casos porque la profundidad de `dist/cli` es la misma. Si el manifiesto no se puede leer (un
 * empaquetado atípico), se cae a candidatos más cercanos y, en último término, al nombre scoped
 * conocido, para que el comando de instalación NUNCA pueda volver a ser un 404 silencioso.
 *
 * El artefacto publicado tiene cero dependencias de runtime (C-STACK-FACT): este módulo solo usa
 * `node:module`.
 */
import { createRequire } from 'node:module';
/** Nombre scoped conocido: último recurso si ningún `package.json` es legible. */
const KNOWN_PACKAGE_NAME = '@brujo2020/open-sdd';
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
/**
 * Leer el `package.json` de la raíz. Los candidatos van de la raíz hacia el workspace local: la
 * raíz es la que lleva el nombre publicado y la versión publicada; el manifiesto de
 * `tools/open-sdd` es `private` y solo sirve como último recurso legible.
 */
export const readPackageIdentity = () => {
    const require = createRequire(import.meta.url);
    const candidates = ['../../../../package.json', '../../../package.json', '../../package.json'];
    for (const candidate of candidates) {
        try {
            const pkg = require(candidate);
            const name = isNonEmptyString(pkg?.name) ? pkg.name : KNOWN_PACKAGE_NAME;
            const version = isNonEmptyString(pkg?.version) ? pkg.version : 'dev';
            return { name, version, source: candidate };
        }
        catch {
            // Siguiente candidato.
        }
    }
    return { name: KNOWN_PACKAGE_NAME, version: 'dev', source: 'fallback' };
};
const identity = readPackageIdentity();
/** Nombre del paquete publicado, tal y como aparece en npm (`@brujo2020/open-sdd`). */
export const PACKAGE_NAME = identity.name;
/** Versión del paquete publicado. `dev` cuando el manifiesto no es legible. */
export const VERSION = identity.version;
/** El ÚNICO comando de instalación que el CLI puede anunciar. */
export const INSTALL_COMMAND = `npx ${PACKAGE_NAME}@latest`;
/** De dónde se derivó la identidad (para `doctor`/diagnóstico). */
export const PACKAGE_IDENTITY_SOURCE = identity.source;
