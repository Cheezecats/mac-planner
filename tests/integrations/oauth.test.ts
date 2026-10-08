import { describe, it, expect, vi } from "vitest";
import {
  OAuthManager,
  IntegrationError,
  type IntegrationVault,
} from "../../src/integrations/index";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
function vault() {
  const data = new Map<string, unknown>();
  return {
    get: async <T>(k: string) => (data.get(k) ?? null) as T | null,
    set: async (k: string, v: unknown) => {
      data.set(k, v);
    },
    delete: async (k: string) => {
      data.delete(k);
    },
  } satisfies IntegrationVault;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
describe("native OAuth", () => {
  it("uses a registered localhost callback with an ephemeral port for Microsoft",async()=>{
    const tokenExchange=vi.fn();const manager=new OAuthManager({vault:vault(),providers:{microsoft:{clientId:"public"}},fetch:tokenExchange,openExternal:async uri=>{
      const auth=new URL(uri);const callback=new URL(auth.searchParams.get("redirect_uri")!);expect(callback.hostname).toBe("localhost");expect(callback.port).not.toBe("");expect(callback.pathname).toBe("/auth/callback");expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
      await fetch(callback+"?state=wrong&code=fake");
    }});await expect(manager.signIn("microsoft",{timeoutMs:1000})).rejects.toMatchObject({code:"oauth-state"});expect(tokenExchange).not.toHaveBeenCalled();
  });
  it("starts a loopback PKCE browser flow and rejects wrong state without token exchange", async () => {
    const http = vi.fn();
    let listener = "";
    const manager = new OAuthManager({
      vault: vault(),
      providers: { google: { clientId: "public" } },
      fetch: http,
      openExternal: async (uri) => {
        const u = new URL(uri);
        listener = u.searchParams.get("redirect_uri")!;
        expect(new URL(listener).hostname).toBe("127.0.0.1");
        expect(u.searchParams.get("code_challenge_method")).toBe("S256");
        await fetch(listener + "?code=fake&state=wrong");
      },
    });
    await expect(
      manager.signIn("google", { timeoutMs: 500 }),
    ).rejects.toMatchObject({ code: "oauth-state" });
    expect(http).not.toHaveBeenCalled();
    await expect(fetch(listener)).rejects.toThrow();
  });
  it("validates signature, issuer, audience and nonce; saves dynamic client before exchanging", async () => {
    const keys = await generateKeyPair("RS256");
    const jwk = {
      ...(await exportJWK(keys.publicKey)),
      kid: "fixture",
      alg: "RS256",
    };
    const v = vault();
    let nonce = "";
    let authURL = "";
    let callback = "";
    const http = vi.fn(async (url: any, init?: RequestInit) => {
      if (String(url).includes("jwks")) return json({ keys: [jwk] });
      expect(await v.get("oauth:registration:openai:new")).toBe(
        "oaiapp_fixture",
      );
      const form = new URLSearchParams(String(init?.body));
      expect(form.get("client_id")).toBe("oaiapp_fixture");
      expect(form.get("resource")).toBe("https://api.openai.com/v1");
      return json({
        access_token: "t",
        refresh_token: "r",
        scope: "openid chatgpt.tokens.use.direct",
        expires_in: 3600,
        id_token: await new SignJWT({ nonce, email: "fixture@example.test" })
          .setProtectedHeader({ alg: "RS256", kid: "fixture" })
          .setIssuer("https://auth.openai.com")
          .setAudience("oaiapp_fixture")
          .setSubject("sub")
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(keys.privateKey),
      });
    });
    const m = new OAuthManager({
      vault: v,
      providers: { openai: { appName: "Planner" } },
      fetch: http,
      openExternal: async (uri) => {
        authURL = uri;
        const u = new URL(uri);
        nonce = u.searchParams.get("nonce")!;
        callback = u.searchParams.get("redirect_uri")!;
        void fetch(
          callback +
            "?code=c&state=" +
            u.searchParams.get("state") +
            "&client_id=oaiapp_fixture",
        );
      },
    });
    const c = await m.signIn("openai");
    expect(new URL(authURL).searchParams.get("client_id")).toBe(
      "dynamic_agent_client",
    );
    expect(new URL(authURL).searchParams.get("ext_agent_host_id")).toBeTruthy();
    expect(c.settings.planUsageEnabled).toBe(true);
    expect(await m.accessToken(c.id)).toBe("t");
    await m.disconnect(c.id);
    expect(await m.session(c.id)).toBeNull();
  });
  it("rejects denied consent, nonce mismatch, and abort; performs no token call on cancel", async () => {
    for (const mode of ["denied", "nonce", "abort"]) {
      const v = vault();
      const controller = new AbortController();
      const keys = await generateKeyPair("RS256");
      const jwk = {
        ...(await exportJWK(keys.publicKey)),
        kid: "x",
        alg: "RS256",
      };
      const http = vi.fn(async (url: any) =>
        String(url).includes("certs")
          ? json({ keys: [jwk] })
          : json({
              access_token: "t",
              expires_in: 3600,
              id_token: await new SignJWT({ nonce: "wrong" })
                .setProtectedHeader({ alg: "RS256", kid: "x" })
                .setIssuer("https://accounts.google.com")
                .setAudience("g")
                .setSubject("s")
                .setIssuedAt()
                .setExpirationTime("1h")
                .sign(keys.privateKey),
            }),
      );
      const m = new OAuthManager({
        vault: v,
        providers: { google: { clientId: "g" } },
        fetch: http,
        openExternal: async (uri) => {
          if (mode === "abort") {
            controller.abort();
            return;
          }
          const u = new URL(uri);
          void fetch(
            u.searchParams.get("redirect_uri")! +
              "?" +
              (mode === "denied" ? "error=access_denied" : "code=c") +
              "&state=" +
              u.searchParams.get("state"),
          );
        },
      });
      await expect(
        m.signIn("google", { signal: controller.signal }),
      ).rejects.toBeInstanceOf(IntegrationError);
      if (mode !== "nonce") expect(http).not.toHaveBeenCalled();
    }
  });
});
it("refreshes expired tokens once concurrently and rotates atomically", async () => {
  const v = vault();
  await v.set("oauth:session:c", {
    connectionId: "c",
    provider: "openai",
    accountId: "s",
    accountName: "Fixture",
    clientId: "client",
    accessToken: "old",
    refreshToken: "old-refresh",
    idToken: "id",
    scopes: ["chatgpt.tokens.use.direct"],
    expiresAt: 0,
  });
  const f = vi.fn(async () =>
    json({
      access_token: "new",
      refresh_token: "new-refresh",
      expires_in: 3600,
      scope: "chatgpt.tokens.use.direct",
    }),
  );
  const m = new OAuthManager({
    vault: v,
    providers: { openai: { appName: "Planner" } },
    openExternal: async () => {},
    fetch: f,
  });
  expect(await Promise.all([m.accessToken("c"), m.accessToken("c")])).toEqual([
    "new",
    "new",
  ]);
  expect(f).toHaveBeenCalledTimes(1);
  expect((await m.session("c"))?.refreshToken).toBe("new-refresh");
});
it("closes timed-out loopback listeners and never exchanges a token", async () => {
  let callback = "";
  const f = vi.fn();
  const m = new OAuthManager({
    vault: vault(),
    providers: { google: { clientId: "g" } },
    openExternal: async (uri) => {
      callback = new URL(uri).searchParams.get("redirect_uri")!;
    },
    fetch: f,
  });
  await expect(m.signIn("google", { timeoutMs: 10 })).rejects.toMatchObject({
    code: "oauth-timeout",
  });
  await expect(fetch(callback)).rejects.toThrow();
  expect(f).not.toHaveBeenCalled();
});
it("never resurrects tokens if disconnect happens while a refresh is in flight", async () => {
  const v = vault();
  await v.set("oauth:session:c", {
    connectionId: "c",
    provider: "openai",
    accountId: "s",
    accountName: "Fixture",
    clientId: "client",
    accessToken: "old",
    refreshToken: "r",
    idToken: "id",
    scopes: [],
    expiresAt: 0,
  });
  let release!: (r: Response) => void;
  const f = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  const m = new OAuthManager({
    vault: v,
    providers: { openai: { appName: "Planner" } },
    openExternal: async () => {},
    fetch: f,
  });
  const pending = m.accessToken("c");
  await new Promise((resolve) => setTimeout(resolve, 5));
  await m.disconnect("c");
  release(
    json({ access_token: "new", refresh_token: "new-r", expires_in: 3600 }),
  );
  await expect(pending).rejects.toMatchObject({ code: "reauthorize" });
  expect(await m.session("c")).toBeNull();
});
it("retains a previously granted refresh token when reauthorization omits a new one", async () => {
  const v = vault();
  await v.set("oauth:session:c", {
    connectionId: "c",
    provider: "google",
    accountId: "s",
    accountName: "Fixture",
    clientId: "g",
    accessToken: "old",
    refreshToken: "persistent-r",
    idToken: "id",
    scopes: [],
    expiresAt: 0,
  });
  const keys = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: "x", alg: "RS256" };
  let nonce = "";
  const f = vi.fn(async (url: any) =>
    String(url).includes("certs")
      ? json({ keys: [jwk] })
      : json({
          access_token: "new",
          expires_in: 3600,
          scope: "openid",
          id_token: await new SignJWT({ nonce })
            .setProtectedHeader({ alg: "RS256", kid: "x" })
            .setIssuer("https://accounts.google.com")
            .setAudience("g")
            .setSubject("s")
            .setIssuedAt()
            .setExpirationTime("1h")
            .sign(keys.privateKey),
        }),
  );
  const m = new OAuthManager({
    vault: v,
    providers: { google: { clientId: "g" } },
    fetch: f,
    openExternal: async (uri) => {
      const u = new URL(uri);
      nonce = u.searchParams.get("nonce")!;
      void fetch(
        u.searchParams.get("redirect_uri")! +
          "?code=c&state=" +
          u.searchParams.get("state"),
      );
    },
  });
  await m.signIn("google", { connectionId: "c" });
  expect((await m.session("c"))?.refreshToken).toBe("persistent-r");
});
