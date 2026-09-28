/**
 * OnePlan REST API client.
 *
 * Handles authentication and HTTP calls to the OnePlan platform.
 * Supports dual-auth: API Key (Basic) for reads, Browser Cookie for writes.
 *
 * Discovered endpoints (March 2026):
 *   Items:      POST /api/basegrid/{planId}/gantt?WorkTypeId={wtId}  (Bryntum sync)
 *   Financials: POST /api/cost/{planId}  (monthly cost grid)
 *   Plan edit:  POST /api/workplan/{planId}?ChangedFields=true
 *   Hierarchy:  POST /api/workplan/{planId}/changetype?PlanType={typeId}&NewParentId={parentId}
 */

import { randomUUID } from "node:crypto";

const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

export interface ListPlansOptions {
  planTypeId?: string;
  top?: number;
  skip?: number;
}

export interface CreatePlanPayload {
  planTypeId: string;
  title: string;
  description?: string;
  parentId?: string;
  properties?: Record<string, unknown>;
}

export interface UpdatePlanPayload {
  title?: string;
  description?: string;
  properties?: Record<string, unknown>;
}

/**
 * Which field collection to operate on. OnePlan keeps four independent
 * collections, each with its own endpoint — discovered in the client bundle
 * OnePlanCoreFieldsAdmin.min.js. Writing to the wrong one puts the field at the
 * wrong level, and plan fields cannot be deleted, so the scope matters.
 */
export type FieldScope = "plan" | "task" | "resource";

export const FIELD_ENDPOINTS: Record<FieldScope, string> = {
  plan: "/api/workplan/fields",
  task: "/api/tasks/fields",
  resource: "/api/resources/fields",
};

/**
 * Build a safe, unique InternalName for a task/resource field.
 *
 * Required there, unlike plan scope where the server derives its own. Kept ASCII and
 * alphanumeric because that is the shape every native field uses, and de-duplicated
 * against the collection since the name is the model field key.
 */
function internalNameFor(payload: CreateFieldPayload, existing: any[]): string {
  const strip = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]/g, "");
  let base = strip(payload.internalName || "") || strip(payload.displayName) || "Field";
  if (/^[0-9]/.test(base)) base = `F${base}`;
  const taken = new Set(
    existing.filter((f) => f.InternalName).map((f) => String(f.InternalName).toLowerCase())
  );
  let name = base;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base}${i}`;
  return name;
}

export interface CreateFieldPayload {
  /**
   * Plan scope: ignored — the server derives its own from DisplayName.
   * Task/resource scope: REQUIRED. Sanitised and de-duplicated by internalNameFor();
   * falls back to DisplayName when blank. Never let it reach the server empty.
   */
  internalName: string;
  displayName: string;
  /** 5 = Choice/dropdown, 3 = Number/currency, 2 = Calculated, 1 = Text */
  columnType?: number;
  /** GUID -> label map. When omitted for a choice field, labels are generated GUIDs. */
  choices?: Record<string, string>;
  /** InternalName of the choice whose GUID becomes the default selection */
  defaultValue?: string;
  description?: string;
  /** Plan type GUIDs this field is writeable on. Empty = all plan types. */
  writeablePlanTypes?: string[];
  required?: boolean;
  /** Allow users to type values not present in Choices */
  allowAdditions?: boolean;
}

export class OnePlanClient {
  private baseUrl: string;
  private apiKey: string;
  private keyName: string;
  private sessionCookie: string | undefined;

  constructor(baseUrl: string, apiKey: string, keyName: string, sessionCookie?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.keyName = keyName;
    this.sessionCookie = sessionCookie;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private headers(useCookie = false): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (useCookie && this.sessionCookie) {
      h["Cookie"] = this.sessionCookie;
      h["X-Requested-With"] = "XMLHttpRequest";
    } else {
      const credentials = Buffer.from(`${this.keyName}:${this.apiKey}`).toString("base64");
      h.Authorization = `Basic ${credentials}`;
    }
    return h;
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    useCookie = false
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const opts: RequestInit = {
      method,
      headers: this.headers(useCookie),
    };

    if (body !== undefined) {
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(url, opts);

    if (!res.ok) {
      let errorBody = "";
      try {
        errorBody = await res.text();
      } catch {
        // ignore
      }
      throw new Error(
        `OnePlan API error ${res.status} ${res.statusText}: ${errorBody}`
      );
    }

    // Some endpoints return 204 No Content
    if (res.status === 204) {
      return {} as T;
    }

    return (await res.json()) as T;
  }

  /** Whether cookie-based auth is available for write operations */
  get hasCookieAuth(): boolean {
    return !!this.sessionCookie;
  }

  // -----------------------------------------------------------------------
  // Plans
  // -----------------------------------------------------------------------

  async listPlans(opts?: ListPlansOptions): Promise<unknown> {
    const params = new URLSearchParams();
    if (opts?.planTypeId) params.set("FilterField", "PlannerTypeId");
    if (opts?.planTypeId) params.set("FilterValue", opts.planTypeId);
    if (opts?.top) params.set("$top", String(opts.top));
    if (opts?.skip) params.set("$skip", String(opts.skip));

    const qs = params.toString();
    return this.request("GET", `/api/workplan${qs ? `?${qs}` : ""}`);
  }

  async getPlan(planId: string): Promise<unknown> {
    return this.request("GET", `/api/workplan/${planId}`);
  }

  async createPlan(payload: CreatePlanPayload): Promise<unknown> {
    const workPlan: Record<string, unknown> = {
      Name: payload.title,
      PlanType: payload.planTypeId,
    };
    if (payload.parentId) {
        workPlan.ParentId = payload.parentId;
    }
    if (payload.description || payload.properties) {
      const fields: Record<string, unknown> = {};
      if (payload.description) fields.Description = payload.description;
      if (payload.properties) Object.assign(fields, payload.properties);
      workPlan.Fields = fields;
    }

    return this.request("POST", "/api/workplan", { WorkPlan: workPlan });
  }

  async updatePlan(
    planId: string,
    payload: UpdatePlanPayload
  ): Promise<unknown> {
    const fields: Record<string, unknown> = {};
    if (payload.description) fields.Description = payload.description;
    if (payload.properties) Object.assign(fields, payload.properties);

    const workPlan: Record<string, unknown> = { Fields: fields };
    if (payload.title) workPlan.Name = payload.title;

    // Use the correct ChangedFields endpoint discovered from browser interception
    return this.request("POST", `/api/workplan/${planId}?ChangedFields=true`,
      { WorkPlan: workPlan }, this.hasCookieAuth);
  }

  // -----------------------------------------------------------------------
  // Steps / Workflow
  // -----------------------------------------------------------------------

  async listSteps(planId: string): Promise<unknown> {
    return this.request("GET", `/api/workplan/${planId}/processhistory`);
  }

  async updateStep(
    planId: string,
    stepId: string,
    comment?: string
  ): Promise<unknown> {
    const body: Record<string, unknown> = { StepId: stepId };
    if (comment) body.Comment = comment;
    return this.request("POST", `/api/workplan/${planId}/step?StepId=${stepId}`, body);
  }

  async approveStep(planId: string, comment?: string): Promise<unknown> {
    const body: Record<string, unknown> = {};
    if (comment) body.Comment = comment;
    return this.request("POST", `/api/workplan/${planId}/step/approve`, body);
  }

  // -----------------------------------------------------------------------
  // Work Items via Bryntum Gantt Sync Protocol
  // Uses: POST /api/basegrid/{planId}/gantt?WorkTypeId={wtId}
  // -----------------------------------------------------------------------

  async listWorkPlanItems(planId: string, workTypeId?: string): Promise<unknown> {
    if (workTypeId) {
      // Use the Gantt grid endpoint for a specific work type
      const r = await this.request<any>("GET",
        `/api/basegrid/${planId}/gantt?WorkTypeId=${workTypeId}`);
      return r?.tasks?.rows || r;
    }
    return this.request("GET", `/api/workplan/${planId}/tasks`);
  }

  async createWorkItem(
    planId: string,
    workTypeId: string,
    name: string,
    fields?: Record<string, unknown>
  ): Promise<unknown> {
    // Bryntum Gantt sync payload discovered from browser interception
    const item: Record<string, unknown> = {
      Name: name,
      StartDate: new Date().toISOString().split('T')[0] + " 08:00:00",
      EndDate: new Date(Date.now() + 86400000*30).toISOString().split('T')[0] + " 17:00:00",
      Duration: 1,
      durationUnit: "day",
      parentId: planId,
      WorkTypeId: workTypeId,
      PercentDone: 0,
      Effort: 0,
      SchedulingMode: "FixedDuration",
      WorkPlanId: planId,
      $PhantomId: "_generatedt_" + crypto.randomUUID(),
      Status: "NotStarted",
      Complete: false,
      TaskScheduleType: 0,
      IsScheduled: false,
      ...fields,
    };
    const payload = {
      type: "sync",
      requestId: Date.now(),
      revision: 0,
      tasks: { added: [item], updated: [] }
    };
    return this.request("POST",
      `/api/basegrid/${planId}/gantt?WorkTypeId=${workTypeId}`,
      payload, this.hasCookieAuth);
  }

  // Legacy alias for backward compatibility
  async updateWorkPlanItem(planId: string, payload: any): Promise<unknown> {
    return this.request("POST", `/api/workplan/${planId}/tasks`, [payload]);
  }

  // -----------------------------------------------------------------------
  // Resources & Directory
  // -----------------------------------------------------------------------

  async listResources(): Promise<unknown> {
    return this.request("GET", "/api/resources");
  }

  async createResource(payload: any): Promise<unknown> {
    return this.request("POST", "/api/resources", payload);
  }

  // -----------------------------------------------------------------------
  // Financials via /api/cost/{planId}
  // -----------------------------------------------------------------------

  async getFinancials(planId: string): Promise<unknown> {
    return this.request("GET", `/api/workplan/financials?planId=${planId}`);
  }

  async upsertCostEntry(
    planId: string,
    costTypeId: string,
    costCategoryId: string,
    date: string,
    value: number,
    zoom = 2,
    rate = "USD"
  ): Promise<unknown> {
    // Discovered endpoint: POST /api/cost/{planId}
    return this.request("POST", `/api/cost/${planId}`, {
      CostType: costTypeId,
      Date: date,
      Value: value,
      Zoom: zoom,
      CostCategory: costCategoryId,
      Rate: rate,
    }, this.hasCookieAuth);
  }

  // Legacy alias
  async upsertFinancials(planId: string, payload: any): Promise<unknown> {
    return this.request("POST", `/api/cost/${planId}`, payload, this.hasCookieAuth);
  }

  // -----------------------------------------------------------------------
  // Hierarchy: Reorganize / Change Parent
  // POST /api/workplan/{id}/changetype?PlanType={typeId}&NewParentId={parentId}
  // -----------------------------------------------------------------------

  async changePlanParent(
    planId: string,
    planTypeId: string,
    newParentId: string
  ): Promise<unknown> {
    const url = `/api/workplan/${planId}/changetype?PlanType=${planTypeId}&NewParentId=${newParentId}`;
    // This endpoint requires empty body with cookie auth
    const res = await fetch(`${this.baseUrl}${url}`, {
      method: "POST",
      headers: this.headers(this.hasCookieAuth),
      body: "",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OnePlan API error ${res.status}: ${text.substring(0, 200)}`);
    }
    return res.json();
  }

  // -----------------------------------------------------------------------
  // My Work (Timesheets / Personal Tasks)
  // -----------------------------------------------------------------------

  async getMyTasks(): Promise<unknown> {
    return this.request("GET", "/api/mywork/tasks");
  }

  // -----------------------------------------------------------------------
  // Admin / Audit / Integrations
  // -----------------------------------------------------------------------

  async getAuditLogs(planId?: string): Promise<unknown> {
    // If planId is provided, fetch specific audits, else global audit
    const endpoint = planId ? `/api/audit/plan/${planId}` : `/api/audit`;
    try {
        return await this.request("GET", endpoint);
    } catch (e) {
        // Fallback for some tenants
        return this.request("GET", `/api/workplan/${planId}/audit`);
    }
  }

  async checkIntegrations(): Promise<unknown> {
    try {
      return await this.request("GET", "/api/integrations");
    } catch (e) {
      return this.request("GET", "/api/integrationevents");
    }
  }

  // -----------------------------------------------------------------------
  // Fields (Schema Management)
  //
  // Four independent collections, each with its own endpoint (see FIELD_ENDPOINTS).
  // /api/config exposes them as PlanFields, CustomColumns, ResourceFields and
  // BacklogFields; only the first three are writeable (/api/backlog/fields 404s).
  //
  // Write semantics differ by scope — verified August 2026 with throwaway fields:
  //
  //   scope     create              update                  delete
  //   plan      POST   root         POST /{id}              none (UI only)
  //   task      POST   root         none — POST /{id} 500   DELETE /{id}  OK
  //
  // So task fields are reversible and plan fields are not. To change a task
  // field, delete it and create it again.
  //
  // DisplayName must be unique *within* a collection (500 "Column with same name
  // already exists") but may repeat *across* them — a task field named
  // "Disciplina" happily coexists with a plan field of the same name.
  // -----------------------------------------------------------------------

  async listFields(scope: FieldScope = "plan"): Promise<unknown> {
    return this.request("GET", FIELD_ENDPOINTS[scope]);
  }

  async updateFieldDisplayName(identifier: string, newDisplayName: string): Promise<unknown> {
    const fields = await this.listFields() as any[];
    const targetField = fields.find(f => f.Id === identifier || f.InternalName === identifier);
    if (!targetField) {
      throw new Error(`Field with ID or Internal Name '${identifier}' not found.`);
    }
    
    targetField.DisplayName = newDisplayName;
    return this.request("POST", `/api/workplan/fields/${targetField.Id}`, targetField);
  }

  async updateFieldChoices(identifier: string, newChoices: Record<string, string>): Promise<unknown> {
    const fields = await this.listFields() as any[];
    const targetField = fields.find(f => f.Id === identifier || f.InternalName === identifier);
    if (!targetField) {
      throw new Error(`Field '${identifier}' not found.`);
    }
    
    // Merge new choices with existing ones
    targetField.Choices = { ...targetField.Choices, ...newChoices };
    return this.request("POST", `/api/workplan/fields/${targetField.Id}`, targetField);
  }

  /**
   * Overwrite a field's Choices wholesale, dropping any option not supplied.
   *
   * Unlike updateFieldChoices (which merges), this removes options. Any plan
   * still holding a removed option's GUID keeps a dangling value that renders
   * blank, so re-tag affected plans before calling this.
   */
  async replaceFieldChoices(
    identifier: string,
    choices: Record<string, string>
  ): Promise<unknown> {
    const fields = (await this.listFields()) as any[];
    const targetField = fields.find(
      (f) => f.Id === identifier || f.InternalName === identifier
    );
    if (!targetField) {
      throw new Error(`Field '${identifier}' not found.`);
    }

    targetField.Choices = choices;
    // A DefaultValue pointing at a removed option would dangle
    if (targetField.DefaultValue && !choices[targetField.DefaultValue]) {
      targetField.DefaultValue = "";
    }
    return this.request(
      "POST",
      `/api/workplan/fields/${targetField.Id}`,
      targetField,
      this.hasCookieAuth
    );
  }

  /**
   * Create a new data field (schema column), typically a dropdown/choice field.
   *
   * Creates go to the collection root: POST /api/workplan/fields. The per-id
   * path (POST /api/workplan/fields/{id}) is update-only — it returns 200 with a
   * null body and silently discards the write when the id does not already
   * exist, so it must not be used for creates.
   */
  async createField(
    payload: CreateFieldPayload,
    scope: FieldScope = "plan"
  ): Promise<unknown> {
    const existing = (await this.listFields(scope)) as any[];

    // Uniqueness is per collection and keyed on DisplayName. Task/resource
    // records carry no InternalName, so that is the only usable key.
    const clash = existing.find(
      (f) =>
        f.DisplayName === payload.displayName ||
        (scope === "plan" && f.InternalName === payload.internalName)
    );
    if (clash) {
      throw new Error(
        `A ${scope} field named '${payload.displayName}' already exists (Id ${clash.Id}). ` +
          (scope === "plan"
            ? `Use updateFieldChoices/updateFieldDisplayName to modify it.`
            : `Update it in place with POST ${FIELD_ENDPOINTS[scope]}/{id}, or deleteField() then create again.`)
      );
    }

    const columnType = payload.columnType ?? 5;
    const choices = payload.choices ?? {};

    // Resolve the default value to the GUID key of the requested choice label
    let defaultValue = "";
    if (payload.defaultValue) {
      const hit = Object.entries(choices).find(
        ([guid, label]) => guid === payload.defaultValue || label === payload.defaultValue
      );
      defaultValue = hit ? hit[0] : payload.defaultValue;
    }

    const fieldId = randomUUID();
    const field: Record<string, unknown> = {
      Id: fieldId,
      Order: 0,
      InternalName: payload.internalName,
      DisplayName: payload.displayName,
      ColumnType: columnType,
      ColumnAggregate: 0,
      Choices: choices,
      NumericValues: {},
      ParentFilterField: "",
      System: false,
      Locked: false,
      ReadOnly: false,
      Required: payload.required ?? false,
      Percentage: false,
      DefaultValue: defaultValue,
      AllowAdditions: payload.allowAdditions ?? false,
      WriteablePlanTypes: payload.writeablePlanTypes ?? [],
      PlanTypeId: EMPTY_GUID,
      Decimals: 0,
      Function: 0,
      RollupWorkType: EMPTY_GUID,
      RollupAggregate: 0,
      RollupField: "",
      RollupFilter: "",
      MinValue: 0,
      MaxValue: 0,
      Description: payload.description ?? "",
      AIEnabled: false,
      AIUseForPlanCreation: false,
      Hidden: false,
      ShowInQuickStart: false,
      MultiLine: false,
      BuiltIn: false,
    };

    // Task/resource fields take a leaner body than plan fields, but InternalName is
    // NOT optional there. The server stores whatever you send and accepts nothing at
    // all — with a 200. A task field with an empty InternalName blanks the Work Plan
    // tab for EVERY plan in the tenant: Bryntum uses it as the model field's `name`
    // and calls name.includes("."), which throws in WorkPlanTaskModel.addField during
    // setupFields, before the Gantt ever requests a task. Unrecoverable in place:
    // InternalName is immutable, and POST /{id} returns 500 on a field missing one.
    const body =
      scope === "plan"
        ? field
        : {
            DisplayName: payload.displayName,
            InternalName: internalNameFor(payload, existing),
            ColumnType: columnType,
            ...(Object.keys(choices).length ? { Choices: choices } : {}),
            ...(payload.required ? { Required: true } : {}),
            ...(payload.description ? { Description: payload.description } : {}),
          };

    return this.request("POST", FIELD_ENDPOINTS[scope], body, this.hasCookieAuth);
  }

  /**
   * Delete a field. Only works for task and resource scope.
   *
   * Plan fields have no working delete endpoint on this tenant. Probed August
   * 2026 with Basic auth:
   *   DELETE /api/workplan/fields/{id}         -> 405 Method Not Allowed
   *   DELETE /api/workplan/fields?id={id}      -> 200 "Delete Successful" but NO-OPS
   *   DELETE /api/workplan/fields?FieldId={id} -> 400 null FieldId
   *   POST   /api/workplan/fields/remove       -> 500 NullReferenceException
   * Remove those through the UI instead (Area Editor > Fields).
   *
   * DELETE /api/tasks/fields/{id} does work, which is what makes task-level
   * schema changes reversible.
   *
   * Deleting is not the only way to change a task field, though: POST
   * /api/tasks/fields/{id} updates one in place. Reach for delete when you need to
   * change the immutable InternalName, or to repair a field created without one.
   */
  async deleteField(identifier: string, scope: FieldScope): Promise<unknown> {
    if (scope === "plan") {
      throw new Error(
        "Plan fields cannot be deleted via the API — remove them in the OnePlan UI " +
          "(Area Editor > Fields). Only task and resource fields support DELETE."
      );
    }

    const fields = (await this.listFields(scope)) as any[];
    const target = fields.find(
      (f) => f.Id === identifier || f.DisplayName === identifier
    );
    if (!target) {
      throw new Error(`No ${scope} field matching '${identifier}'.`);
    }
    if (target.System) {
      throw new Error(
        `'${target.DisplayName}' is a built-in ${scope} field and cannot be deleted.`
      );
    }

    const result = await this.request(
      "DELETE",
      `${FIELD_ENDPOINTS[scope]}/${target.Id}`,
      undefined,
      this.hasCookieAuth
    );

    // OnePlan returns 200 on wrong paths, so confirm by re-reading.
    const after = (await this.listFields(scope)) as any[];
    if (after.some((f) => f.Id === target.Id)) {
      throw new Error(
        `Delete returned success but '${target.DisplayName}' is still present.`
      );
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // Work Types
  // -----------------------------------------------------------------------

  /**
   * List all work types (Tasks, Risks, Issues, Changes, and any custom types).
   * Tries the dedicated /api/worktype endpoint first; falls back to extracting
   * unique WorkTypeIds from a sample of work items across plans.
   */
  async listWorkTypes(): Promise<unknown[]> {
    try {
      const data = await this.request<unknown[]>("GET", "/api/worktype");
      if (Array.isArray(data) && data.length > 0) return data;
    } catch {
      // endpoint may not exist on all tenants — fall through to fallback
    }
    // Fallback: derive work types from existing work items
    const plans = (await this.request<any[]>("GET", "/api/workplan")).slice(0, 10);
    const typeMap = new Map<string, Record<string, unknown>>();
    for (const plan of plans) {
      try {
        const items = await this.request<any[]>("GET", `/api/workplan/${plan.Id}/tasks`);
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          if (item.WorkTypeId && !typeMap.has(item.WorkTypeId)) {
            typeMap.set(item.WorkTypeId, {
              Id: item.WorkTypeId,
              Name: item.WorkTypeName ?? item.WorkTypeId,
            });
          }
        }
      } catch { /* skip plans with no items */ }
    }
    return Array.from(typeMap.values());
  }

  // -----------------------------------------------------------------------
  // Plan Types
  // -----------------------------------------------------------------------

  async listPlanTypes(): Promise<unknown> {
    // OnePlan doesn't have a dedicated PlanTypes endpoint.
    // We derive plan types from the workplan list by extracting unique PlannerTypeId values.
    const plans = (await this.request("GET", "/api/workplan")) as Array<{ PlannerTypeId?: string; Fields?: Record<string, unknown> }>;
    const typeMap = new Map<string, string>();
    for (const p of plans) {
      if (p.PlannerTypeId && !typeMap.has(p.PlannerTypeId)) {
        typeMap.set(p.PlannerTypeId, p.PlannerTypeId);
      }
    }
    return Array.from(typeMap.entries()).map(([id]) => ({ Id: id }));
  }

  async getPlanType(identifier: string): Promise<unknown> {
    const types = (await this.listPlanTypes()) as Array<{ Id: string }>;
    const match = types.find(
      (t) => t.Id.toLowerCase() === identifier.toLowerCase()
    );

    if (!match) {
      throw new Error(`Plan type not found: "${identifier}"`);
    }

    return match;
  }

  async getGroup(): Promise<unknown> {
    return this.request("GET", "/api/resources/megroup");
  }
}
