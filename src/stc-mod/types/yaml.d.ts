declare module 'yaml' {
    // Minimal type declarations to satisfy the TypeScript language service
    // in this JS-based project. The runtime implementation is provided by
    // the installed `yaml` package used by SillyTavern.
    export function parse(source: string): any;
    export function stringify(value: any, replacer?: any, indent?: number): string;

    // Fallback default export used by some import styles
    const YAML: {
        parse: typeof parse;
        stringify: typeof stringify;
    };

    export default YAML;
}

