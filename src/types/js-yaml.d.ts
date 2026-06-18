// js-yaml is bundled transitively via @openshift-console/dynamic-plugin-sdk (it powers the
// console's own YAML editing) and is already in the lockfile. We declare the minimal surface we
// use for the editable workload manifest rather than adding a redundant @types/js-yaml devDep.
declare module 'js-yaml' {
  export function load(input: string): unknown;
}
