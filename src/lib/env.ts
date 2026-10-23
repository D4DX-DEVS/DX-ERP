import "server-only";

/**
 * Typed access to environment variables. Values are read lazily so `next build`
 * succeeds without secrets; a missing required value throws when first used.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optional(name: string, fallback = ""): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

export const env = {
  get mongoUri() {
    return required("MONGODB_URI");
  },
  get mongoDb() {
    return optional("MONGODB_DB");
  },
  get authSecret() {
    const secret = required("AUTH_SECRET");
    if (secret.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters long");
    return secret;
  },
  get appUrl() {
    return optional("APP_URL", "http://localhost:3000").replace(/\/+$/, "");
  },
  get timezone() {
    return optional("NEXT_PUBLIC_APP_TIMEZONE", "Asia/Kolkata");
  },
  get cronSecret() {
    return optional("CRON_SECRET");
  },
  google: {
    get clientId() {
      return required("GOOGLE_CLIENT_ID");
    },
    get clientSecret() {
      return required("GOOGLE_CLIENT_SECRET");
    },
    /** Optional: restrict Google sign-in to one Workspace domain (e.g. d4dx.co). */
    get allowedDomain() {
      return optional("GOOGLE_ALLOWED_DOMAIN").toLowerCase();
    },
    get configured() {
      return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    },
  },
  superAdmin: {
    get email() {
      return required("SUPER_ADMIN_EMAIL").toLowerCase();
    },
    get password() {
      return optional("SUPER_ADMIN_PASSWORD");
    },
    /** Optional scrypt hash produced by `npm run hash-password` (takes precedence over the plain password). */
    get passwordHash() {
      return optional("SUPER_ADMIN_PASSWORD_HASH");
    },
    get name() {
      return optional("SUPER_ADMIN_NAME", "Super Admin");
    },
    /** Optional base32 TOTP secret; when set, super admin sign-in requires a 6-digit code. */
    get totpSecret() {
      return optional("SUPER_ADMIN_TOTP_SECRET").replace(/\s+/g, "").toUpperCase();
    },
  },
  spaces: {
    get key() {
      return required("DO_SPACES_KEY");
    },
    get secret() {
      return required("DO_SPACES_SECRET");
    },
    get endpoint() {
      const raw = required("DO_SPACES_ENDPOINT");
      return raw.startsWith("http") ? raw.replace(/\/+$/, "") : `https://${raw.replace(/\/+$/, "")}`;
    },
    get region() {
      return optional("DO_SPACES_REGION", "us-east-1");
    },
    get bucket() {
      return required("DO_SPACES_BUCKET");
    },
    get cdnUrl() {
      return optional("DO_SPACES_CDN_URL").replace(/\/+$/, "");
    },
    get folder() {
      return optional("DO_SPACES_FOLDER", "dx-erp").replace(/^\/+|\/+$/g, "");
    },
    get configured() {
      return Boolean(
        process.env.DO_SPACES_KEY &&
          process.env.DO_SPACES_SECRET &&
          process.env.DO_SPACES_ENDPOINT &&
          process.env.DO_SPACES_BUCKET,
      );
    },
  },
  smtp: {
    get host() {
      return optional("SMTP_HOST");
    },
    get port() {
      return Number(optional("SMTP_PORT", "587"));
    },
    get user() {
      return optional("SMTP_USER");
    },
    get password() {
      return optional("SMTP_PASSWORD");
    },
    get from() {
      return optional("SMTP_FROM", "D4DX ERP <no-reply@d4dx.co>");
    },
    get configured() {
      return Boolean(process.env.SMTP_HOST);
    },
  },
  vault: {
    /** 32-byte key (64 hex chars or base64) that wraps every project's secrets key. Never store it in the database. */
    get masterKey() {
      return optional("VAULT_MASTER_KEY");
    },
    /** The old master key while rotating; wrapped project keys are re-wrapped with the new key on next use. */
    get previousMasterKey() {
      return optional("VAULT_MASTER_KEY_PREVIOUS");
    },
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
};
