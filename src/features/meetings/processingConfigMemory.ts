import type { ProcessingConfig } from './library';

/**
 * The last model configuration the user submitted in this run. Kept in memory
 * only (never written to disk) so "Tentar de novo" can repeat it without
 * asking for the file again; after a restart the user picks the file once.
 */
let last: ProcessingConfig | null = null;

export function rememberProcessingConfig(config: ProcessingConfig) {
  last = config;
}

export function recalledProcessingConfig() {
  return last;
}

export function forgetProcessingConfig() {
  last = null;
}
