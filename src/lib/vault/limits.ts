/**
 * Key-file limits shared by the vault's server actions and its client form. 512 KB stays well under D1's
 * 2 MB row limit once the bytes are base64-encoded and sealed; signing keystores and certificates are a few KB.
 */
export const MAX_VAULT_FILES = 10;
export const MAX_VAULT_FILE_BYTES = 512 * 1024;
