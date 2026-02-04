import { createAppJwt } from "./appAuth";

export async function getInstallationToken(
  installationId: number
): Promise<string> {
  const jwt = createAppJwt();

  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "CodeCloze",
      },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Failed to get installation token: ${res.status} ${text}`
    );
  }

  const data = await res.json();
  return data.token;
}
