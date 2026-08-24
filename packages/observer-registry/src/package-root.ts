/**
 * Public half of Yoink's offline observer-recipe root. The private half is
 * deployment material and must never be present in the repository, server
 * process, extension package, portability archive, or HTTP API.
 */
export const PACKAGED_OBSERVER_RECIPE_ROOT = Object.freeze({
  algorithm: "Ed25519" as const,
  keyId: "de8bd79dba5c4be92be4624a5bee0aebf232ecc5a08a6f24e78492966fede2cc",
  publicKeySpki: "MCowBQYDK2VwAyEAyFBoHLFeHWkzqLDvD4cmlVPuyFc1ZJHSxVf7Na1Z0hc",
  minimumManifestGeneration: 1
});
