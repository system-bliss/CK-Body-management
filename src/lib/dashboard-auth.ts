const sessionTtlSeconds = 60 * 60 * 24 * 30;

export async function verifyPassword(candidate: string, expected: string): Promise<boolean> {
  if (!candidate || !expected) return false;
  return timingSafeEqual(await digest(candidate), await digest(expected));
}

export async function createSessionCookie(secret: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const expires = nowSeconds + sessionTtlSeconds;
  const payload = `${expires}`;
  const signature = await hmac(secret, payload);
  return `ck_session=${payload}.${signature}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${sessionTtlSeconds}`;
}

export function clearSessionCookie(): string {
  return "ck_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";
}

export async function verifySessionCookie(cookieHeader: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const value = parseCookie(cookieHeader, "ck_session");
  if (!value) return false;
  const [expiresText, signature] = value.split(".");
  if (!expiresText || !signature) return false;
  const expires = Number(expiresText);
  if (!Number.isFinite(expires) || expires < nowSeconds) return false;
  const expected = await hmac(secret, expiresText);
  return timingSafeEqual(signature, expected);
}

function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const cookie of header.split(";")) {
    const [key, ...rest] = cookie.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(bytes));
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64Url(new Uint8Array(signature));
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
