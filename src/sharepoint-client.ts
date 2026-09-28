/**
 * SharePoint REST API Client
 *
 * Generic migration-ready client that reads from any SharePoint Online site.
 * Supports 3 authentication methods:
 *   1. Azure AD App Registration (client credentials)
 *   2. Browser Session Cookie (captured from user login)
 *   3. Basic / NTLM (on-prem Project Server / legacy)
 */

export type SpAuthMethod = "app" | "cookie" | "basic";

export interface SpClientConfig {
  siteUrl: string;        // e.g. https://contoso.sharepoint.com/sites/PMO
  authMethod: SpAuthMethod;

  // Option 1: Azure AD App
  clientId?: string;
  clientSecret?: string;
  tenantId?: string;

  // Option 2: Browser Cookie
  sessionCookie?: string;

  // Option 3: Basic / NTLM
  username?: string;
  password?: string;
}

export class SharePointClient {
  private config: SpClientConfig;
  private accessToken: string | null = null;
  private tokenExpiry = 0;

  constructor(config: SpClientConfig) {
    this.config = {
      ...config,
      siteUrl: config.siteUrl.replace(/\/+$/, ""),
    };
  }

  // -----------------------------------------------------------------------
  // Authentication
  // -----------------------------------------------------------------------

  /**
   * Get auth headers based on configured method.
   * Azure AD tokens are cached until expiry.
   */
  private async getAuthHeaders(): Promise<Record<string, string>> {
    switch (this.config.authMethod) {
      case "app":
        return this.getAppAuthHeaders();
      case "cookie":
        return this.getCookieAuthHeaders();
      case "basic":
        return this.getBasicAuthHeaders();
      default:
        throw new Error(`Unknown auth method: ${this.config.authMethod}`);
    }
  }

  /** Azure AD Client Credentials Flow (OAuth 2.0) */
  private async getAppAuthHeaders(): Promise<Record<string, string>> {
    if (!this.config.clientId || !this.config.clientSecret || !this.config.tenantId) {
      throw new Error("Azure AD auth requires SP_CLIENT_ID, SP_CLIENT_SECRET, and SP_TENANT_ID");
    }

    // Reuse cached token if still valid
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json;odata=verbose",
      };
    }

    const tokenUrl = `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`;

    // Extract the hostname for the scope (e.g. contoso.sharepoint.com)
    const spHost = new URL(this.config.siteUrl).origin;

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: `${spHost}/.default`,
    });

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Azure AD token error ${res.status}: ${text.substring(0, 300)}`);
    }

    const data = await res.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // Refresh 60s before expiry

    return {
      Authorization: `Bearer ${this.accessToken}`,
      Accept: "application/json;odata=verbose",
    };
  }

  /** Browser cookie-based auth (same approach as OnePlan) */
  private async getCookieAuthHeaders(): Promise<Record<string, string>> {
    if (!this.config.sessionCookie) {
      throw new Error("Cookie auth requires SP_SESSION_COOKIE");
    }
    return {
      Cookie: this.config.sessionCookie,
      Accept: "application/json;odata=verbose",
      "X-Requested-With": "XMLHttpRequest",
    };
  }

  /** Basic / NTLM auth for on-prem servers */
  private async getBasicAuthHeaders(): Promise<Record<string, string>> {
    if (!this.config.username || !this.config.password) {
      throw new Error("Basic auth requires SP_USERNAME and SP_PASSWORD");
    }
    const encoded = Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64");
    return {
      Authorization: `Basic ${encoded}`,
      Accept: "application/json;odata=verbose",
    };
  }

  // -----------------------------------------------------------------------
  // Internal HTTP helper
  // -----------------------------------------------------------------------

  private async request<T = unknown>(url: string): Promise<T> {
    const headers = await this.getAuthHeaders();
    const res = await fetch(url, { method: "GET", headers });

    if (!res.ok) {
      let body = "";
      try { body = await res.text(); } catch { /* ignore */ }
      throw new Error(`SharePoint API error ${res.status}: ${body.substring(0, 300)}`);
    }

    const json = await res.json();
    // SharePoint REST wraps results in d.results (OData verbose) or value (OData nometadata)
    return (json?.d?.results ?? json?.d ?? json?.value ?? json) as T;
  }

  // -----------------------------------------------------------------------
  // SharePoint List Operations
  // -----------------------------------------------------------------------

  /** Get all items from a SharePoint list */
  async getListItems(
    listTitle: string,
    siteUrl?: string,
    top = 500,
    select?: string,
    filter?: string
  ): Promise<unknown[]> {
    const site = (siteUrl || this.config.siteUrl).replace(/\/+$/, "");
    const params = new URLSearchParams();
    params.set("$top", String(top));
    if (select) params.set("$select", select);
    if (filter) params.set("$filter", filter);

    const url = `${site}/_api/web/lists/getbytitle('${encodeURIComponent(listTitle)}')/items?${params}`;
    return this.request<unknown[]>(url);
  }

  /** Get the field schema of a SharePoint list */
  async getListFields(
    listTitle: string,
    siteUrl?: string
  ): Promise<unknown[]> {
    const site = (siteUrl || this.config.siteUrl).replace(/\/+$/, "");
    const url = `${site}/_api/web/lists/getbytitle('${encodeURIComponent(listTitle)}')/fields?$filter=Hidden eq false and ReadOnlyField eq false`;
    return this.request<unknown[]>(url);
  }

  /** List all lists in a site */
  async getLists(siteUrl?: string): Promise<unknown[]> {
    const site = (siteUrl || this.config.siteUrl).replace(/\/+$/, "");
    const url = `${site}/_api/web/lists?$filter=Hidden eq false&$select=Title,Id,ItemCount,Description,BaseTemplate`;
    return this.request<unknown[]>(url);
  }

  /** Discover subsites under a site */
  async getSubsites(siteUrl?: string): Promise<unknown[]> {
    const site = (siteUrl || this.config.siteUrl).replace(/\/+$/, "");
    const url = `${site}/_api/web/webs?$select=Title,Url,Description,Created`;
    return this.request<unknown[]>(url);
  }

  /** Get site info */
  async getSiteInfo(siteUrl?: string): Promise<unknown> {
    const site = (siteUrl || this.config.siteUrl).replace(/\/+$/, "");
    const url = `${site}/_api/web?$select=Title,Url,Description,Created`;
    return this.request(url);
  }
}
