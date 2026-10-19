export const defaultIO = {
    log: (s) => console.log(s),
    error: (s) => console.error(s),
    exit: (code) => process.exit(code),
};
