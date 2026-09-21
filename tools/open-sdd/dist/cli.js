#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runCli } from './index.js';
import { loadLocalHosts, renderLocalHostsReport } from './core/localHosts.js';
// Execute when run as a script
void (async () => {
    const here = fileURLToPath(new URL('.', import.meta.url));
    // dist -> package root
    const packageRoot = path.resolve(here, '..');
    const argv = process.argv.slice(2);
    // El overlay privado se carga SOLO aqui: las matrices siguen puras para las pruebas, y un fichero
    // privado no puede hacer que una suite pase o falle.
    const overlay = loadLocalHosts();
    for (const line of renderLocalHostsReport(overlay))
        console.error(line);
    const exitCode = await runCli(argv, { platform: process.platform, env: process.env }, undefined, {}, { templatesRoot: packageRoot });
    if (Number.isInteger(exitCode))
        process.exit(exitCode);
})();
