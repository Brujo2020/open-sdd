import { agentList, getAgentDefinition } from '../agents/registry.js';
import { supportedLanguages } from '../constants/languages.js';
const agentAliasMap = new Map();
const agentValueMap = new Map();
for (const agent of agentList) {
    const definition = getAgentDefinition(agent);
    agentAliasMap.set(agent, agent);
    agentValueMap.set(agent, agent);
    definition.aliasFlags.forEach((flag) => {
        const name = flag.startsWith('--') ? flag.slice(2) : flag;
        agentAliasMap.set(name, agent);
        agentValueMap.set(name, agent);
    });
}
const booleanFlags = new Set([
    'yes',
    'y',
    'dry-run',
    'backup',
    ...agentAliasMap.keys(),
]);
const valueFlags = new Set(['agent', 'lang', 'os', 'overwrite', 'kiro-dir', 'sdd-dir', 'backup', 'manifest', 'profile']);
const isKnownFlag = (name) => booleanFlags.has(name) || valueFlags.has(name);
const isEnum = (val, allowed) => allowed.includes(val);
export const parseArgs = (argv) => {
    const out = {};
    let i = 0;
    let seenAgent;
    const setAgent = (value) => {
        if (seenAgent && seenAgent !== value) {
            throw new Error('agent flag conflict between multiple agent selections');
        }
        seenAgent = value;
        out.agent = value;
    };
    while (i < argv.length) {
        const token = argv[i++];
        if (!token.startsWith('-')) {
            throw new Error(`Unknown positional argument: ${token}`);
        }
        if (token === '-y') {
            out.yes = true;
            continue;
        }
        if (token.startsWith('--')) {
            const eqIdx = token.indexOf('=');
            const name = token.slice(2, eqIdx > -1 ? eqIdx : undefined);
            if (!isKnownFlag(name)) {
                throw new Error(`Unknown flag: --${name}`);
            }
            const aliasAgent = agentAliasMap.get(name);
            if (aliasAgent && !valueFlags.has(name)) {
                setAgent(aliasAgent);
                continue;
            }
            let value;
            if (eqIdx > -1) {
                value = token.slice(eqIdx + 1);
            }
            else if (valueFlags.has(name)) {
                const peek = argv[i];
                if (peek && !peek.startsWith('-')) {
                    value = peek;
                    i += 1;
                }
                else {
                    if (name === 'backup') {
                        value = true;
                    }
                    else {
                        throw new Error(`Flag --${name} requires a value`);
                    }
                }
            }
            else {
                value = true;
            }
            switch (name) {
                case 'dry-run':
                    out.dryRun = true;
                    break;
                case 'backup': {
                    if (value === true)
                        out.backup = true;
                    else
                        out.backup = String(value);
                    break;
                }
                case 'yes':
                    out.yes = true;
                    break;
                case 'y':
                    out.yes = true;
                    break;
                case 'kiro-dir':
                    out.kiroDir = String(value);
                    break;
                case 'sdd-dir':
                    out.sddDir = String(value);
                    out.kiroDir = String(value);
                    break;
                case 'lang': {
                    const v = String(value);
                    if (!isEnum(v, supportedLanguages))
                        throw new Error('lang value invalid');
                    out.lang = v;
                    break;
                }
                case 'os': {
                    const v = String(value);
                    if (!isEnum(v, ['auto', 'mac', 'windows', 'linux']))
                        throw new Error('os value invalid');
                    out.os = v;
                    break;
                }
                case 'overwrite': {
                    const v = String(value);
                    if (!isEnum(v, ['prompt', 'skip', 'force']))
                        throw new Error('overwrite value invalid');
                    out.overwrite = v;
                    break;
                }
                case 'manifest': {
                    out.manifest = String(value);
                    break;
                }
                case 'profile': {
                    const v = String(value);
                    if (!isEnum(v, ['full', 'minimal']))
                        throw new Error('profile value invalid');
                    out.profile = v;
                    break;
                }
                case 'agent': {
                    const v = String(value);
                    const mapped = agentValueMap.get(v);
                    if (!mapped)
                        throw new Error('agent value invalid');
                    setAgent(mapped);
                    break;
                }
                default: {
                    const mapped = agentAliasMap.get(name);
                    if (mapped) {
                        setAgent(mapped);
                        break;
                    }
                    if (!booleanFlags.has(name)) {
                        throw new Error(`Unknown flag: --${name}`);
                    }
                    break;
                }
            }
            continue;
        }
        throw new Error(`Unknown flag format: ${token}`);
    }
    return out;
};
