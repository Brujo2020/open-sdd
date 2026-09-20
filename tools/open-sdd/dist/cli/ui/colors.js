const supportsColor = !!process.stdout.isTTY && process.env.NO_COLOR !== '1';
const wrap = (open, close) => {
    return (value) => {
        if (!supportsColor)
            return value;
        return `${open}${value}${close}`;
    };
};
export const colors = {
    green: wrap('\u001b[32m', '\u001b[39m'),
    red: wrap('\u001b[31m', '\u001b[39m'),
    yellow: wrap('\u001b[33m', '\u001b[39m'),
    cyan: wrap('\u001b[36m', '\u001b[39m'),
    magenta: wrap('\u001b[35m', '\u001b[39m'),
    bold: wrap('\u001b[1m', '\u001b[22m'),
    dim: wrap('\u001b[2m', '\u001b[22m'),
    white: wrap('\u001b[37m', '\u001b[39m'),
    reset: (value) => value,
};
export const formatLabel = (label) => colors.bold(colors.cyan(label));
export const formatHeading = (label) => colors.bold(label);
export const formatSuccess = (msg) => colors.green(msg);
export const formatWarning = (msg) => colors.yellow(msg);
export const formatError = (msg) => colors.red(msg);
export const formatAttention = (msg) => {
    if (!supportsColor)
        return msg;
    return `\u001b[93m\u001b[1m${msg}\u001b[22m\u001b[39m`;
};
export const formatSectionTitle = (label) => {
    if (!supportsColor)
        return `== ${label} ==`;
    return `
[35m[1m== ${label} ==[22m[39m`;
};
export const formatBox = (title) => {
    const line = '─'.repeat(title.length + 4);
    if (!supportsColor)
        return `${line}\n  ${title}\n${line}`;
    return `${colors.dim(line)}\n  ${colors.bold(title)}\n${colors.dim(line)}`;
};
