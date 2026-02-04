import jwt from "jsonwebtoken";

export function createAppJwt(): string {
  const appId = process.env.GITHUB_APP_ID;
  const privateKeyBase64 = process.env.GITHUB_PRIVATE_KEY_BASE64;

  if (!appId || !privateKeyBase64) {
    throw new Error("GitHub App credentials are not set");
  }

  // Decode Base64 → PEM
  let privateKey: string;
  try {
    privateKey = Buffer.from(
      privateKeyBase64,
      "base64"
    ).toString("utf8");
  } catch (err) {
    throw new Error(`Failed to decode private key from Base64: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Validate private key format
  if (!privateKey.includes("BEGIN") || !privateKey.includes("PRIVATE KEY")) {
    throw new Error("Decoded private key does not appear to be a valid PEM format");
  }

  // Restore newlines if they're missing (common when Base64 encoding removes them)
  // PEM format requires newlines, but some encoding methods strip them
  if (!privateKey.includes("\n")) {
    // Extract the key body (between BEGIN and END markers)
    const match = privateKey.match(/-----BEGIN ([^-]+)-----([^-]+)-----END ([^-]+)-----/);
    if (match) {
      const [, keyType, keyBody, endType] = match;
      const cleanedBody = keyBody.replace(/\s/g, "");
      // Insert newlines every 64 characters (standard PEM line length)
      const bodyWithNewlines = cleanedBody.match(/.{1,64}/g)?.join("\n") || cleanedBody;
      privateKey = `-----BEGIN ${keyType}-----\n${bodyWithNewlines}\n-----END ${endType}-----\n`;
    }
  }

  // Log the beginning of the decoded private key for debugging
  console.log("Decoded private key start:", privateKey.substring(0, 50));

  const now = Math.floor(Date.now() / 1000);

  try {
    return jwt.sign(
      {
        iat: now - 60,        // issued 1 min ago (clock skew safety)
        exp: now + 9 * 60,    // max 10 min
        iss: appId,
      },
      privateKey,
      { algorithm: "RS256" }
    );
  } catch (err) {
    throw new Error(`Failed to sign JWT: ${err instanceof Error ? err.message : String(err)}`);
  }
}
