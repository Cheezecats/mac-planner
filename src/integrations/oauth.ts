import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { jwtVerify, createRemoteJWKSet, decodeJwt, customFetch } from "jose";
import {
  IntegrationError,
  type IntegrationVault,
  type Provider,
  type OAuthSession,
  type Connection,
} from "./types";
export interface OAuthManagerOptions {
  vault: IntegrationVault;
  openExternal: (url: string) => Promise<void>;
  providers: {
    google?: { clientId: string };
    microsoft?: { clientId: string; tenant?: string };
    openai?: { appName: string };
  };
  fetch?: typeof fetch;
  now?: () => number;
}
export interface SignInOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  connectionId?: string;
  requestConsent?: boolean;
}
const SCOPE = {
  google: [
    "openid",
    "profile",
    "email",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.events.readonly",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  ],
  microsoft: [
    "openid",
    "profile",
    "email",
    "offline_access",
    "User.Read",
    "Mail.Read",
    "Calendars.Read",
  ],
  openai: [
    "openid",
    "profile",
    "email",
    "offline_access",
    "resource.invoke",
    "chatgpt.tokens.use.direct",
  ],
};
export class OAuthManager {
  private fetcher: typeof fetch;
  private refreshes = new Map<string, Promise<string>>();
  private disconnected = new Set<string>();
  constructor(private options: OAuthManagerOptions) {
    this.fetcher = options.fetch ?? fetch;
  }
  private now() {
    return this.options.now?.() ?? Date.now();
  }
  private endpoints(provider: Provider) {
    const tenant = this.options.providers.microsoft?.tenant ?? "common";
    if (!/^(common|organizations|consumers|[a-f\d-]{36})$/i.test(tenant))
      throw new IntegrationError("configuration", "Invalid Microsoft tenant.");
    return provider === "google"
      ? {
          authorize: "https://accounts.google.com/o/oauth2/v2/auth",
          token: "https://oauth2.googleapis.com/token",
          jwks: "https://www.googleapis.com/oauth2/v3/certs",
          issuer: "https://accounts.google.com",
        }
      : provider === "openai"
        ? {
            authorize: "https://auth.openai.com/api/accounts/authorize",
            token: "https://auth.openai.com/api/accounts/oauth/token",
            jwks: "https://auth.openai.com/.well-known/jwks.json",
            issuer: "https://auth.openai.com",
          }
        : {
            authorize: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
            token: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
            jwks: `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`,
            issuer: "",
          };
  }
  async session(connectionId: string): Promise<OAuthSession | null> {
    return this.options.vault.get<OAuthSession>(
      "oauth:session:" + connectionId,
    );
  }
  async signIn(
    provider: Provider,
    options: SignInOptions = {},
  ): Promise<Connection> {
    if (!this.options.providers[provider])
      throw new IntegrationError(
        "configuration",
        `Configure a ${provider} public client before connecting.`,
      );
    options.signal?.throwIfAborted();
    const prior = options.connectionId
      ? await this.session(options.connectionId)
      : null;
    if (prior && prior.provider !== provider)
      throw new IntegrationError(
        "configuration",
        "Selected account belongs to another provider.",
      );
    const config = this.options.providers[provider];
    let clientId =
      prior?.clientId ??
      (provider === "openai"
        ? ((await this.options.vault.get<string>(
            "oauth:registration:openai:new",
          )) ?? "dynamic_agent_client")
        : (config as { clientId: string }).clientId);
    if (!clientId)
      throw new IntegrationError(
        "configuration",
        "A registered public client ID is required.",
      );
    const state = randomBytes(32).toString("base64url"),
      nonce = randomBytes(32).toString("base64url"),
      verifier = randomBytes(48).toString("base64url");
    const endpoints = this.endpoints(provider);
    let server: Server | undefined,
      timer: ReturnType<typeof setTimeout> | undefined;
    let abort = () => {};
    let rejectCallback: (e: unknown) => void = () => {};
    const result = new Promise<URLSearchParams>((resolve, reject) => {
      rejectCallback = reject;
      server = createServer((req, res) => {
        const u = new URL(req.url ?? "/", `http://127.0.0.1`);
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        if (req.method !== "GET" || u.pathname !== "/auth/callback") {
          res.writeHead(404);
          res.end("Not found.");
          return;
        }
        if (u.searchParams.get("state") !== state) {
          res.writeHead(400);
          res.end("Invalid sign-in state.");
          reject(
            new IntegrationError(
              "oauth-state",
              "Sign-in state did not match. Please retry.",
            ),
          );
          return;
        }
        if (u.searchParams.has("error")) {
          res.writeHead(400);
          res.end("Sign-in was not completed.");
          reject(
            new IntegrationError(
              "oauth-cancelled",
              "Sign-in was declined or cancelled.",
            ),
          );
          return;
        }
        if (!u.searchParams.get("code")) {
          res.writeHead(400);
          res.end("Missing authorization code.");
          reject(
            new IntegrationError(
              "oauth-code",
              "Sign-in did not return an authorization code.",
            ),
          );
          return;
        }
        res.end("Sign-in received. You may return to Planner.");
        resolve(u.searchParams);
      });
    });
    // Attach rejection before asynchronous setup: cancellation during browser opening must not leak an unhandled rejection.
    void result.catch(() => {});
    try {
      await new Promise<void>((resolve, reject) => {
        server!.once("error", reject);
        server!.listen(0, "127.0.0.1", () => resolve());
      });
      const address = server!.address();
      if (!address || typeof address === "string")
        throw new Error("Callback listener failed.");
      const callbackHost = provider === "microsoft" ? "localhost" : "127.0.0.1";
      const redirectUri = `http://${callbackHost}:${address.port}/auth/callback`;
      timer = setTimeout(
        () =>
          rejectCallback(
            new IntegrationError(
              "oauth-timeout",
              "Sign-in timed out. Please retry.",
            ),
          ),
        options.timeoutMs ?? 180000,
      );
      abort = () =>
        rejectCallback(
          new IntegrationError("oauth-cancelled", "Sign-in was cancelled."),
        );
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
      const query = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: SCOPE[provider].join(" "),
        state,
        nonce,
        code_challenge_method: "S256",
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
      });
      if (provider === "google") query.set("access_type", "offline");
      if (options.requestConsent) query.set("prompt", "consent");
      if (provider === "openai") {
        let hostId = await this.options.vault.get<string>(
          "oauth:openai:hostId",
        );
        if (!hostId) {
          hostId = "urn:uuid:" + randomUUID();
          await this.options.vault.set("oauth:openai:hostId", hostId);
        }
        query.set("resource", "https://api.openai.com/v1");
        query.set("ext_agent_host_id", hostId);
        if (clientId === "dynamic_agent_client")
          query.set("agent_name_hint", (config as { appName: string }).appName);
        if (prior?.idToken) query.set("id_token_hint", prior.idToken);
      }
      await this.options.openExternal(`${endpoints.authorize}?${query}`);
      const callback = await result;
      options.signal?.throwIfAborted();
      const issued = callback.get("client_id");
      if (provider === "openai") {
        if (clientId === "dynamic_agent_client") {
          if (!issued || issued === "dynamic_agent_client")
            throw new IntegrationError(
              "oauth-client",
              "Registration did not issue a client ID.",
            );
          clientId = issued;
          await this.options.vault.set(
            "oauth:registration:openai:new",
            clientId,
          );
        } else if (issued && issued !== clientId)
          throw new IntegrationError(
            "oauth-client",
            "Returned client ID does not match the selected account.",
          );
      }
      const form = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code: callback.get("code")!,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      });
      if (provider === "openai")
        form.set("resource", "https://api.openai.com/v1");
      const data = await this.token(endpoints.token, form, options.signal);
      const identity = await this.verify(
        provider,
        data.id_token,
        clientId,
        nonce,
        options.signal,
      );
      options.signal?.throwIfAborted();
      if (prior && prior.accountId !== identity.sub)
        throw new IntegrationError(
          "oauth-account",
          "Sign-in returned a different account. Add it as a new connection.",
        );
      const accountId = String(identity.sub);
      const connectionId =
        prior?.connectionId ??
        `${provider}-${createHash("sha256")
          .update(JSON.stringify([identity.iss, clientId, accountId]))
          .digest("hex")
          .slice(0, 24)}`;
      const scopes =
        typeof data.scope === "string"
          ? data.scope.split(/\s+/).filter(Boolean)
          : [];
      const existing = prior ?? (await this.session(connectionId));
      const session: OAuthSession = {
        connectionId,
        provider,
        accountId,
        accountName: String(
          identity.email ??
            identity.preferred_username ??
            identity.name ??
            accountId,
        ),
        clientId,
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? existing?.refreshToken,
        idToken: data.id_token,
        scopes,
        expiresAt: this.now() + Number(data.expires_in) * 1000,
        earliestRefreshAt: this.refreshTime(data.earliest_refresh_at),
      };
      this.disconnected.delete(connectionId);
      await this.options.vault.set("oauth:session:" + connectionId, session);
      if (provider === "openai") {
        await this.options.vault.set(
          "oauth:registration:openai:" + connectionId,
          clientId,
        );
        await this.options.vault.delete("oauth:registration:openai:new");
      }
      return {
        id: connectionId,
        provider,
        accountName: session.accountName,
        status: "connected",
        settings: {
          accountId,
          scopes,
          planUsageEnabled:
            provider === "openai" &&
            scopes.includes("chatgpt.tokens.use.direct"),
        },
      };
    } finally {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      server?.closeAllConnections();
      if (server?.listening)
        await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
  }
  private refreshTime(raw: unknown) {
    if (typeof raw === "number") return raw < 1e12 ? raw * 1000 : raw;
    if (typeof raw === "string") {
      const n = Date.parse(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
  }
  private async verify(
    provider: Provider,
    idToken: unknown,
    clientId: string,
    nonce: string,
    signal?: AbortSignal,
  ) {
    if (typeof idToken !== "string")
      throw new IntegrationError(
        "oauth-identity",
        "Identity token is missing.",
      );
    const ep = this.endpoints(provider);
    let issuer = ep.issuer;
    if (provider === "microsoft") {
      const tid = decodeJwt(idToken).tid;
      if (typeof tid !== "string" || !/^[a-f\d-]{36}$/i.test(tid))
        throw new IntegrationError(
          "oauth-identity",
          "Microsoft tenant is invalid.",
        );
      const tenant = this.options.providers.microsoft?.tenant ?? "common";
      if (
        /^[a-f\d-]{36}$/i.test(tenant) &&
        tenant.toLowerCase() !== tid.toLowerCase()
      )
        throw new IntegrationError(
          "oauth-identity",
          "Microsoft tenant does not match.",
        );
      issuer = `https://login.microsoftonline.com/${tid}/v2.0`;
    }
    try {
      const { payload } = await jwtVerify(
        idToken,
        createRemoteJWKSet(new URL(ep.jwks), {
          [customFetch]: (url, init) => this.fetcher(url, { ...init, signal }),
        }),
        {
          issuer:
            provider === "google" ? [issuer, "accounts.google.com"] : issuer,
          audience: clientId,
          algorithms: ["RS256"],
        },
      );
      if (
        payload.nonce !== nonce ||
        typeof payload.sub !== "string" ||
        !payload.exp
      )
        throw new Error("Invalid nonce or subject.");
      return payload;
    } catch {
      throw new IntegrationError(
        "oauth-identity",
        "Identity signature, issuer, audience or nonce did not validate.",
      );
    }
  }
  private async token(
    url: string,
    form: URLSearchParams,
    signal?: AbortSignal,
  ) {
    const response = await this.fetcher(url, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal,
    });
    if (!response.ok)
      throw new IntegrationError(
        response.status === 400 ? "reauthorize" : "oauth-http",
        "Authorization could not be renewed. Reconnect the account.",
        response.status,
      );
    const data = (await response.json()) as any;
    if (
      typeof data.access_token !== "string" ||
      !Number.isFinite(Number(data.expires_in)) ||
      Number(data.expires_in) <= 0
    )
      throw new IntegrationError(
        "oauth-token",
        "Provider returned an invalid token response.",
      );
    return data;
  }
  async accessToken(
    connectionId: string,
    forceRefresh = false,
  ): Promise<string> {
    if (this.disconnected.has(connectionId))
      throw new IntegrationError("reauthorize", "Account was disconnected.");
    const s = await this.session(connectionId);
    if (!s)
      throw new IntegrationError("reauthorize", "Connect this account first.");
    if (!forceRefresh && s.expiresAt > this.now() + 60000) return s.accessToken;
    if (this.refreshes.has(connectionId))
      return this.refreshes.get(connectionId)!;
    const pending = this.refresh(s);
    this.refreshes.set(connectionId, pending);
    try {
      return await pending;
    } finally {
      this.refreshes.delete(connectionId);
    }
  }
  private async refresh(s: OAuthSession) {
    if (!s.refreshToken)
      throw new IntegrationError(
        "reauthorize",
        "This account must be connected again.",
      );
    if (s.earliestRefreshAt && s.earliestRefreshAt > this.now())
      throw new IntegrationError(
        "refresh-not-ready",
        "Token renewal is not available yet. Retry later.",
      );
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: s.clientId,
      refresh_token: s.refreshToken,
    });
    if (s.provider === "openai")
      form.set("resource", "https://api.openai.com/v1");
    const data = await this.token(this.endpoints(s.provider).token, form);
    if (this.disconnected.has(s.connectionId))
      throw new IntegrationError("reauthorize", "Account was disconnected.");
    await this.options.vault.set("oauth:session:" + s.connectionId, {
      ...s,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? s.refreshToken,
      scopes: data.scope ? data.scope.split(/\s+/) : s.scopes,
      expiresAt: this.now() + Number(data.expires_in) * 1000,
      earliestRefreshAt: this.refreshTime(data.earliest_refresh_at),
    });
    if (this.disconnected.has(s.connectionId)) {
      await this.options.vault.delete("oauth:session:" + s.connectionId);
      throw new IntegrationError("reauthorize", "Account was disconnected.");
    }
    return data.access_token as string;
  }
  /** Local removal always succeeds. Google additionally revokes its token. Microsoft/OpenAI grants are managed in provider account settings. */
  async disconnect(connectionId: string) {
    this.disconnected.add(connectionId);
    const s = await this.session(connectionId);
    await this.options.vault.delete("oauth:session:" + connectionId);
    await this.options.vault.delete(
      "oauth:registration:openai:" + connectionId,
    );
    if (s?.provider === "google") {
      try {
        await this.fetcher("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          redirect: "error",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: s.refreshToken ?? s.accessToken,
          }).toString(),
        });
      } catch {
        /* local disconnect remains authoritative */
      }
    }
  }
}
