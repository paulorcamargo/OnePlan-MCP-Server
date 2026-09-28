/**
 * Project Online (PWA) OData Client
 *
 * Reads project data from Project Web App via the OData reporting API.
 * Reuses the same SharePoint auth infrastructure (same Azure AD token works for both).
 *
 * Key endpoints:
 *   /_api/ProjectData/Projects
 *   /_api/ProjectData/Projects('{id}')/Tasks
 *   /_api/ProjectData/Projects('{id}')/Assignments
 *   /_api/ProjectData/Resources
 */

export interface PwaClientConfig {
  pwaUrl: string;           // e.g. https://contoso.sharepoint.com/sites/PWA
  getAuthHeaders: () => Promise<Record<string, string>>;  // Reuse from SharePointClient
}

export class PwaClient {
  private pwaUrl: string;
  private getAuthHeaders: () => Promise<Record<string, string>>;

  constructor(config: PwaClientConfig) {
    this.pwaUrl = config.pwaUrl.replace(/\/+$/, "");
    this.getAuthHeaders = config.getAuthHeaders;
  }

  // -----------------------------------------------------------------------
  // Internal HTTP helper
  // -----------------------------------------------------------------------

  private async request<T = unknown>(url: string): Promise<T> {
    const headers = await this.getAuthHeaders();
    // PWA OData prefers json nometadata for cleaner responses
    headers["Accept"] = "application/json;odata=nometadata";

    const res = await fetch(url, { method: "GET", headers });

    if (!res.ok) {
      let body = "";
      try { body = await res.text(); } catch { /* ignore */ }
      throw new Error(`PWA API error ${res.status}: ${body.substring(0, 300)}`);
    }

    const json = await res.json();
    return (json?.value ?? json?.d?.results ?? json) as T;
  }

  // -----------------------------------------------------------------------
  // Projects
  // -----------------------------------------------------------------------

  /** List all projects from PWA reporting API */
  async getProjects(
    top = 200,
    select?: string,
    filter?: string
  ): Promise<unknown[]> {
    const params = new URLSearchParams();
    params.set("$top", String(top));
    if (select) params.set("$select", select);
    if (filter) params.set("$filter", filter);

    return this.request<unknown[]>(
      `${this.pwaUrl}/_api/ProjectData/Projects?${params}`
    );
  }

  /** Get a single project by its GUID */
  async getProject(projectId: string): Promise<unknown> {
    return this.request(
      `${this.pwaUrl}/_api/ProjectData/Projects(guid'${projectId}')`
    );
  }

  // -----------------------------------------------------------------------
  // Tasks
  // -----------------------------------------------------------------------

  /** Get all tasks for a specific project */
  async getTasks(
    projectId: string,
    top = 500,
    select?: string
  ): Promise<unknown[]> {
    const params = new URLSearchParams();
    params.set("$top", String(top));
    if (select) params.set("$select", select);

    return this.request<unknown[]>(
      `${this.pwaUrl}/_api/ProjectData/Projects(guid'${projectId}')/Tasks?${params}`
    );
  }

  // -----------------------------------------------------------------------
  // Assignments (who is assigned to what)
  // -----------------------------------------------------------------------

  /** Get resource assignments for a project */
  async getAssignments(
    projectId: string,
    top = 500
  ): Promise<unknown[]> {
    return this.request<unknown[]>(
      `${this.pwaUrl}/_api/ProjectData/Projects(guid'${projectId}')/Assignments?$top=${top}`
    );
  }

  // -----------------------------------------------------------------------
  // Resources
  // -----------------------------------------------------------------------

  /** List all resources in the PWA resource pool */
  async getResources(top = 500): Promise<unknown[]> {
    return this.request<unknown[]>(
      `${this.pwaUrl}/_api/ProjectData/Resources?$top=${top}`
    );
  }

  // -----------------------------------------------------------------------
  // Custom fields (Enterprise custom fields)
  // -----------------------------------------------------------------------

  /** Get project custom field values */
  async getProjectCustomFields(projectId: string): Promise<unknown[]> {
    return this.request<unknown[]>(
      `${this.pwaUrl}/_api/ProjectData/Projects(guid'${projectId}')/CustomFields`
    );
  }

  // -----------------------------------------------------------------------
  // Risks, Issues, Deliverables (from SharePoint Project Site)
  // These live on the project's associated SharePoint site, not OData.
  // We provide helpers that build the standard list URL.
  // -----------------------------------------------------------------------

  /**
   * Build the SharePoint project site URL for a given project.
   * PWA projects typically have sites at: {pwaUrl}/{ProjectName}
   * or: {pwaUrl}/ProjectSites/{ProjectName}
   *
   * The caller should pass the project's ProjectSiteUrl if available.
   */
  getProjectSiteListUrl(projectSiteUrl: string, listTitle: string, top = 200): string {
    const site = projectSiteUrl.replace(/\/+$/, "");
    return `${site}/_api/web/lists/getbytitle('${encodeURIComponent(listTitle)}')/items?$top=${top}`;
  }

  /** Convenience: read a project site list directly */
  async getProjectSiteList(
    projectSiteUrl: string,
    listTitle: string,
    top = 200
  ): Promise<unknown[]> {
    const url = this.getProjectSiteListUrl(projectSiteUrl, listTitle, top);
    return this.request<unknown[]>(url);
  }
}
