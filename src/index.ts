#!/usr/bin/env node

/**
 * OnePlan MCP Server
 *
 * Provides AI agents with tools to interact with the OnePlan.ai
 * project/portfolio management platform via the Model Context Protocol.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { OnePlanClient } from "./oneplan-client.js";
import { SharePointClient, SpAuthMethod } from "./sharepoint-client.js";
import { PwaClient } from "./pwa-client.js";

// ---------------------------------------------------------------------------
// Environment & Config
// ---------------------------------------------------------------------------
const API_KEY = process.env.ONEPLAN_API_KEY;
const KEY_NAME = process.env.ONEPLAN_KEY_NAME;
const BASE_URL = process.env.ONEPLAN_BASE_URL ?? "https://mygraph.oneplan.ai";
const SESSION_COOKIE = process.env.ONEPLAN_SESSION_COOKIE; // Optional: enables write operations

if (!API_KEY) {
  console.error("Error: ONEPLAN_API_KEY environment variable is required.");
  process.exit(1);
}

if (!KEY_NAME) {
  console.error("Error: ONEPLAN_KEY_NAME environment variable is required.");
  process.exit(1);
}

const client = new OnePlanClient(BASE_URL, API_KEY, KEY_NAME, SESSION_COOKIE);
if (SESSION_COOKIE) {
  console.error("Cookie auth enabled – write operations available.");
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------
const server = new McpServer({
  name: "oneplan",
  version: "1.0.0",
});

// ---------------------------------------------------------------------------
// Tool: List Plans
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_list_plans",
  "List plans (projects, ideas, programs) from OnePlan. Optionally filter by plan type.",
  {
    planTypeId: z
      .string()
      .optional()
      .describe("GUID of the plan type to filter by"),
    top: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Max number of plans to return (default 50)"),
    skip: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Number of plans to skip for pagination"),
  },
  async ({ planTypeId, top, skip }) => {
    const data = await client.listPlans({ planTypeId, top, skip });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: Get Plan
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_get_plan",
  "Get detailed information about a specific OnePlan plan by its ID.",
  {
    planId: z.string().describe("The GUID of the plan to retrieve"),
  },
  async ({ planId }) => {
    const data = await client.getPlan(planId);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: Create Plan
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_create_plan",
  "Create a new plan (project, idea, or program) in OnePlan. Creating a plan does NOT create any work items — the schedule is loaded separately. Note that the plan's Start/End are read-only: OnePlan derives them from the work plan, so passing StartDate/EndDate in properties is silently dropped (and a direct write returns 500).",
  {
    planTypeId: z.string().describe("GUID of the plan type to create"),
    title: z.string().describe("Title/name of the new plan"),
    description: z.string().optional().describe("Description of the plan"),
    parentId: z.string().optional().describe("GUID of parent program/portfolio to nest this plan under"),
    properties: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Additional plan properties as key-value pairs"),
  },
  async ({ planTypeId, title, description, parentId, properties }) => {
    const data = await client.createPlan({
      planTypeId,
      title,
      description,
      parentId,
      properties,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: Update Plan
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_update_plan",
  "Update an existing plan's properties in OnePlan.",
  {
    planId: z.string().describe("GUID of the plan to update"),
    title: z.string().optional().describe("New title for the plan"),
    description: z.string().optional().describe("New description"),
    properties: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Properties to update as key-value pairs"),
  },
  async ({ planId, title, description, properties }) => {
    const data = await client.updatePlan(planId, {
      title,
      description,
      properties,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: Update Plan Step
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_update_step",
  "Update a plan's workflow step (move it forward or backward in the process).",
  {
    planId: z.string().describe("GUID of the plan"),
    stepId: z.string().describe("GUID of the target step"),
    comment: z.string().optional().describe("Comment for the step transition"),
  },
  async ({ planId, stepId, comment }) => {
    const data = await client.updateStep(planId, stepId, comment);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: Approve Plan Step
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_approve_step",
  "Approve a plan's current workflow step.",
  {
    planId: z.string().describe("GUID of the plan"),
    comment: z.string().optional().describe("Approval comment"),
  },
  async ({ planId, comment }) => {
    const data = await client.approveStep(planId, comment);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: List Plan Types
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_list_plan_types",
  "List all available plan types and their GUIDs in OnePlan.",
  {},
  async () => {
    const data = await client.listPlanTypes();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: Get Plan Type
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_get_plan_type",
  "Get details of a specific plan type by name or GUID.",
  {
    identifier: z
      .string()
      .describe("Plan type name or GUID to look up"),
  },
  async ({ identifier }) => {
    const data = await client.getPlanType(identifier);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: List Plan Steps
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_list_steps",
  "List workflow steps available for a specific plan.",
  {
    planId: z.string().describe("GUID of the plan"),
  },
  async ({ planId }) => {
    const data = await client.listSteps(planId);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: List Global Data Fields
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_list_fields",
  "List OnePlan's data fields and schema definitions. OnePlan keeps separate field collections per level: 'plan' (project/portfolio attributes), 'task' (work item / schedule columns) and 'resource'. A field existing at one level says nothing about the others — always pass the scope you mean.",
  {
    scope: z.enum(["plan", "task", "resource"]).optional().describe("Which field collection to read. 'plan' (default) = project fields, 'task' = work item fields, 'resource' = resource fields."),
    searchTerm: z.string().optional().describe("Optionally search for a field by InternalName or DisplayName"),
  },
  async ({ scope, searchTerm }) => {
    let data = await client.listFields(scope ?? "plan") as any[];
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      data = data.filter(f => 
        (f.InternalName && f.InternalName.toLowerCase().includes(lower)) ||
        (f.DisplayName && f.DisplayName.toLowerCase().includes(lower))
      );
    }
    // Limit output to prevent massive payload issues (return max 15 results if not searching)
    if (!searchTerm && data.length > 50) {
        data = data.slice(0, 50);
        data.push({ __note: `There are ${data.length} more fields not shown. Use searchTerm to find specific ones.` } as any);
    }
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: Update Field Display Name
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_update_field_name",
  "Update the Display Name of a specific field. This changes how the field is shown in the UI, but does not alter its Internal database Name.",
  {
    fieldIdentifier: z.string().describe("The InternalName or the exact GUID (Id) of the field to update"),
    newDisplayName: z.string().describe("The new display name to apply to the field"),
  },
  async ({ fieldIdentifier, newDisplayName }) => {
    const data = await client.updateFieldDisplayName(fieldIdentifier, newDisplayName);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: List WorkPlan Items (Risks, Issues, Changes, Tasks, etc.)
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_list_workplan_items",
  "List all work items (e.g. Risks, Issues, Changes, Tasks) belonging to a specific plan's List/Work area. Includes WorkTypeId to identify the item's custom type.",
  {
    planId: z.string().describe("The GUID of the Plan"),
    workTypeId: z.string().optional().describe("Optionally filter by a specific WorkTypeId (e.g. only risks)"),
  },
  async ({ planId, workTypeId }) => {
    let data = await client.listWorkPlanItems(planId) as any[];
    if (workTypeId) {
      data = data.filter(item => item.WorkTypeId === workTypeId);
    }
    // Limit to prevent payload overflow
    if (data.length > 50) {
      data = data.slice(0, 50);
      data.push({ __note: `List truncated to 50 items. There are more items in this plan.` } as any);
    }
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: Create or Update WorkPlan Item (Risk, Issue, Change, Task, etc.)
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_upsert_workplan_item",
  "Create or update a generic Work Item (Risk, Issue, Change, Task) under a Plan's 'Work' list area.",
  {
    planId: z.string().describe("The GUID of the Plan"),
    payload: z
      .record(z.string(), z.unknown())
      .describe(
        "The item properties to save. For creating new items, include Name and WorkTypeId. For updates, include the existing Id and fields to change."
      ),
  },
  async ({ planId, payload }) => {
    const data = await client.updateWorkPlanItem(planId, payload);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: Create Work Item via Bryntum Gantt Sync (Tasks, Risks, Issues, etc.)
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_create_work_item",
  "Create a work item (Task, Risk, Issue, Change, etc.) in a plan using the Bryntum Gantt sync protocol. Requires a WorkTypeId to specify the category.",
  {
    planId: z.string().describe("The GUID of the Plan"),
    workTypeId: z.string().describe("The WorkTypeId GUID (e.g. Tasks=e2a5e9dc, Risks=e04d627c, Issues=92af3dcc, Changes=315497d8)"),
    name: z.string().describe("Name of the work item to create"),
    fields: z.record(z.string(), z.unknown()).optional().describe("Optional additional fields like { StartDate, EndDate, Priority, etc. }"),
  },
  async ({ planId, workTypeId, name, fields }) => {
    const data = await client.createWorkItem(planId, workTypeId, name, fields);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: Upsert Cost Entry (Monthly Financial Grid)
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_upsert_cost_entry",
  "Insert or update a monthly cost entry in a plan's financial grid. Use this to set Budget, Actuals, or Forecast for a specific month and cost category.",
  {
    planId: z.string().describe("The GUID of the Plan"),
    costTypeId: z.string().describe("CostType GUID: Budget=d44da584, Actuals=0783f20d, Forecast=3a1769d8"),
    costCategoryId: z.string().describe("CostCategory GUID (e.g. Developer=062705df, Materials=1774eed6)"),
    date: z.string().describe("First day of the month in YYYY-MM-DD format (e.g. 2026-01-01)"),
    value: z.number().describe("The dollar amount for this cost entry"),
    zoom: z.number().optional().describe("Zoom level (2 = monthly, default)"),
    rate: z.string().optional().describe("Currency code (default: USD)"),
  },
  async ({ planId, costTypeId, costCategoryId, date, value, zoom, rate }) => {
    const data = await client.upsertCostEntry(planId, costTypeId, costCategoryId, date, value, zoom, rate);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: Change Plan Parent (Reorganize Hierarchy)
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_change_plan_parent",
  "Move a plan under a new parent portfolio or program. This reorganizes the plan hierarchy.",
  {
    planId: z.string().describe("GUID of the plan to move"),
    planTypeId: z.string().describe("PlannerTypeId of the plan being moved (get from plan details)"),
    newParentId: z.string().describe("GUID of the new parent plan (portfolio or program)"),
  },
  async ({ planId, planTypeId, newParentId }) => {
    const data = await client.changePlanParent(planId, planTypeId, newParentId);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: List Resources (Users/Generic Resources)
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_list_resources",
  "Fetch the list of users or generic resources in the OnePlan organization directory. Returns emails, Ids, and basic info so you can assign items to people.",
  {},
  async () => {
    let data = await client.listResources() as any[];
    // Limiting to prevent blowing up the LLM payload window if there are 1000s
    if (data && data.length > 50) {
      data = data.slice(0, 50);
      data.push({ __note: `List truncated to 50 resources. There are more people in this directory.` } as any);
    }
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: Get My Work / My Tasks
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_get_my_tasks",
  "Fetch the current authenticated user's assigned personal tasks or 'My Work' queue.",
  {},
  async () => {
    const data = await client.getMyTasks();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: Get Financials (Budgets/Forecasts/Actuals)
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_get_financials",
  "Fetch the Financial Plan (budgets, forecasts, and actuals) attached to a specific Plan GUID.",
  {
    planId: z.string().describe("The GUID of the Plan"),
  },
  async ({ planId }) => {
    const data = await client.getFinancials(planId);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: Upsert Financials (Budgets/Forecasts/Actuals)
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_upsert_financials",
  "Push external financial data (Actuals, Budgets, Forecasts) directly into a Plan's financial planner DB. Essential for ERP integration bridging.",
  {
    planId: z.string().describe("The GUID of the Plan to push the costs to"),
    financialPayload: z
      .union([z.record(z.string(), z.unknown()), z.array(z.record(z.string(), z.unknown()))])
      .describe(
        "The financial cost object or array. This is usually mapped to OnePlan Cost Categories, Charge Types, Cost, and Periods."
      ),
  },
  async ({ planId, financialPayload }) => {
    const data = await client.upsertFinancials(planId, financialPayload);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);


// ---------------------------------------------------------------------------
// Tool: Create Resource
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_create_resource",
  "Provision a new user or generic resource in OnePlan.",
  {
    payload: z.record(z.string(), z.unknown()).describe("The resource fields like { Email: 'foo@bar.com', Name: 'Foo' }"),
  },
  async ({ payload }) => {
    const data = await client.createResource(payload);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: Check Audit Logs
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_get_audit_logs",
  "Fetch intelligent audit logs to figure out who changed data, when, and what the previous values were.",
  {
    planId: z.string().optional().describe("Optionally pass the plan GUID to only fetch audits for that plan"),
  },
  async ({ planId }) => {
    const data = await client.getAuditLogs(planId) as any[];
    return { content: [{ type: "text", text: JSON.stringify(data? data.slice(0, 30) : data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: Check Integrations Status
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_check_integrations",
  "Fetch the status of background integrations like Jira, ADO, ServiceNow, or OneConnect flows.",
  {},
  async () => {
    const data = await client.checkIntegrations();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: Upsert Field Dropdown Choices
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_upsert_field_choice",
  "Add a new dropdown value to a PLAN field's 'Choices' mapping safely. Plan scope only. Task fields do support update (POST /api/tasks/fields/{id}) but this tool does not target them yet — change a task field's options there directly, or delete it with oneplan_delete_field and create it again.",
  {
    fieldIdentifier: z.string().describe("The InternalName or Id of the plan field"),
    newChoices: z.record(z.string(), z.string()).describe("A key-value map of new choices to append (e.g. { 'newGuid': 'My New Option' })"),
  },
  async ({ fieldIdentifier, newChoices }) => {
    const data = await client.updateFieldChoices(fieldIdentifier, newChoices);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: Create Data Field (dropdown / choice column)
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_create_field",
  "Create a data field in the OnePlan schema. Defaults to a dropdown (choice) field; pass the options as labels and the GUIDs are generated for you. IMPORTANT: pick the right scope — 'plan' fields describe the project, 'task' fields describe work items/schedule rows. Plan fields CANNOT be deleted afterwards (UI only); task fields can. When in doubt, create at task scope first.",
  {
    scope: z.enum(["plan", "task", "resource"]).optional().describe("Which collection to create in. 'plan' (default) = project fields (NOT deletable afterwards), 'task' = work item fields (deletable), 'resource' = resource fields."),
    internalName: z.string().describe("Internal database name, ASCII, no spaces or accents (e.g. 'DeliveryModel'). For plan scope the server ignores it and derives its own from displayName. For task/resource scope it is REQUIRED and stored verbatim — a task field with an empty one blanks the Work Plan tab for every plan in the tenant. It is sanitised and de-duplicated before sending, so passing displayName-like text is safe."),
    displayName: z.string().describe("Label shown in the UI (e.g. 'Modelo de Entrega')"),
    options: z.array(z.string()).optional().describe("Dropdown option labels, in display order. Omit for non-choice field types."),
    columnType: z.number().optional().describe("5 = Choice/dropdown (default), 3 = Number/currency, 2 = Calculated, 1 = Text"),
    defaultOption: z.string().optional().describe("Which option label should be preselected by default"),
    description: z.string().optional().describe("Help text describing the field's purpose"),
    writeablePlanTypes: z.array(z.string()).optional().describe("Plan type GUIDs this field applies to. Omit for all plan types."),
    required: z.boolean().optional().describe("Whether the field must be filled in"),
    allowAdditions: z.boolean().optional().describe("Allow users to enter values not in the option list"),
  },
  async ({ scope, internalName, displayName, options, columnType, defaultOption, description, writeablePlanTypes, required, allowAdditions }) => {
    // Mint a stable GUID per option label so the Choices map matches OnePlan's shape
    const choices: Record<string, string> = {};
    for (const label of options ?? []) {
      choices[randomUUID()] = label;
    }

    const data = await client.createField(
      {
        internalName,
        displayName,
        columnType,
        choices,
        defaultValue: defaultOption,
        description,
        writeablePlanTypes,
        required,
        allowAdditions,
      },
      scope ?? "plan"
    );
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: Delete Field
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_delete_field",
  "Delete a task or resource field. Plan fields have no working delete endpoint and must be removed through the OnePlan UI (Area Editor > Fields) — the tool refuses those rather than silently no-opping. Task fields can be edited in place via POST /api/tasks/fields/{id}, so reach for delete only to change the immutable InternalName or to repair a field created without one (which blanks the Work Plan tab tenant-wide).",
  {
    scope: z.enum(["task", "resource"]).describe("Which collection the field lives in. Plan fields are not deletable via API."),
    fieldIdentifier: z.string().describe("The field's GUID (Id) or its exact DisplayName"),
  },
  async ({ scope, fieldIdentifier }) => {
    const data = await client.deleteField(fieldIdentifier, scope);
    return { content: [{ type: "text", text: JSON.stringify({ deleted: fieldIdentifier, scope, result: data }, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: List Work Types
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_list_work_types",
  "List all work types available in OnePlan (Tasks, Risks, Issues, Changes, and any custom work types). Returns the WorkTypeId GUID and name for each type. Use this before creating work items to find the correct WorkTypeId for a custom type.",
  {},
  async () => {
    const data = await client.listWorkTypes();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// SharePoint / PWA Migration Source (conditional — only if SP_SITE_URL is set)
// ---------------------------------------------------------------------------
const SP_SITE_URL = process.env.SP_SITE_URL;
const SP_AUTH_METHOD = (process.env.SP_AUTH_METHOD || "app") as SpAuthMethod;

let spClient: SharePointClient | null = null;
let pwaClient: PwaClient | null = null;

if (SP_SITE_URL) {
  const spConfig = {
    siteUrl: SP_SITE_URL,
    authMethod: SP_AUTH_METHOD,
    clientId: process.env.SP_CLIENT_ID,
    clientSecret: process.env.SP_CLIENT_SECRET,
    tenantId: process.env.SP_TENANT_ID,
    sessionCookie: process.env.SP_SESSION_COOKIE,
    username: process.env.SP_USERNAME,
    password: process.env.SP_PASSWORD,
  };

  spClient = new SharePointClient(spConfig);
  console.error(`SharePoint source configured: ${SP_SITE_URL} (auth: ${SP_AUTH_METHOD})`);

  // PWA client uses same site URL and shares auth via the SP client
  // The PWA URL can optionally differ (e.g. if PWA is on a different site)
  const pwaUrl = process.env.PWA_URL || SP_SITE_URL;
  // Expose the auth headers getter from SP client for reuse
  const spForAuth = new SharePointClient(spConfig);
  pwaClient = new PwaClient({
    pwaUrl,
    getAuthHeaders: async (): Promise<Record<string, string>> => {
      // Re-use the same auth logic from the SharePoint client
      switch (SP_AUTH_METHOD) {
        case "app": {
          const tokenUrl = `https://login.microsoftonline.com/${spConfig.tenantId}/oauth2/v2.0/token`;
          const spHost = new URL(pwaUrl).origin;
          const body = new URLSearchParams({
            grant_type: "client_credentials",
            client_id: spConfig.clientId!,
            client_secret: spConfig.clientSecret!,
            scope: `${spHost}/.default`,
          });
          const res = await fetch(tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
          });
          const data = await res.json();
          return { Authorization: `Bearer ${data.access_token}` } as Record<string, string>;
        }
        case "cookie":
          return {
            Cookie: spConfig.sessionCookie!,
            "X-Requested-With": "XMLHttpRequest",
          } as Record<string, string>;
        case "basic": {
          const encoded = Buffer.from(`${spConfig.username}:${spConfig.password}`).toString("base64");
          return { Authorization: `Basic ${encoded}` } as Record<string, string>;
        }
      }
    },
  });
  console.error(`PWA source configured: ${pwaUrl}`);

  // =========================================================================
  // SharePoint Source Tools
  // =========================================================================

  server.tool(
    "sp_list_items",
    "Read items from any SharePoint list. Use this to extract Risks, Issues, Deliverables, Action Items, or any custom list from a project site.",
    {
      listTitle: z.string().describe("The SharePoint list title (e.g. 'Risks', 'Issues', 'Deliverables')"),
      siteUrl: z.string().optional().describe("Override the default site URL (use for project subsites)"),
      top: z.number().optional().describe("Max items to return (default 500)"),
      select: z.string().optional().describe("Comma-separated fields to return (e.g. 'Title,Status,Priority')"),
      filter: z.string().optional().describe("OData filter expression (e.g. \"Status eq 'Active'\")"),
    },
    async ({ listTitle, siteUrl, top, select, filter }) => {
      if (!spClient) throw new Error("SharePoint not configured. Set SP_SITE_URL env var.");
      const data = await spClient.getListItems(listTitle, siteUrl, top, select, filter);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "sp_list_fields",
    "Get the field schema (columns) of a SharePoint list. Useful for mapping fields before migration.",
    {
      listTitle: z.string().describe("The SharePoint list title"),
      siteUrl: z.string().optional().describe("Override the default site URL"),
    },
    async ({ listTitle, siteUrl }) => {
      if (!spClient) throw new Error("SharePoint not configured.");
      const data = await spClient.getListFields(listTitle, siteUrl);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "sp_list_subsites",
    "Discover all subsites (project sites) under a SharePoint site collection. Each project in PWA typically has its own subsite with Risks/Issues lists.",
    {
      siteUrl: z.string().optional().describe("Parent site URL to search under (uses default if omitted)"),
    },
    async ({ siteUrl }) => {
      if (!spClient) throw new Error("SharePoint not configured.");
      const data = await spClient.getSubsites(siteUrl);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "sp_get_lists",
    "List all visible SharePoint lists in a site. Shows list names, item counts, and types — useful for discovering what data is available for migration.",
    {
      siteUrl: z.string().optional().describe("Site URL to query (uses default if omitted)"),
    },
    async ({ siteUrl }) => {
      if (!spClient) throw new Error("SharePoint not configured.");
      const data = await spClient.getLists(siteUrl);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "sp_get_site_info",
    "Get basic info about a SharePoint site (title, URL, description).",
    {
      siteUrl: z.string().optional().describe("Site URL (uses default if omitted)"),
    },
    async ({ siteUrl }) => {
      if (!spClient) throw new Error("SharePoint not configured.");
      const data = await spClient.getSiteInfo(siteUrl);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // =========================================================================
  // PWA Source Tools
  // =========================================================================

  server.tool(
    "pwa_list_projects",
    "List all projects from Project Online (PWA). Returns project names, IDs, dates, and status. Use this as the starting point for migration.",
    {
      top: z.number().optional().describe("Max projects to return (default 200)"),
      select: z.string().optional().describe("Comma-separated fields (e.g. 'ProjectId,ProjectName,ProjectStartDate')"),
      filter: z.string().optional().describe("OData filter (e.g. \"ProjectType eq 'Project'\")"),
    },
    async ({ top, select, filter }) => {
      if (!pwaClient) throw new Error("PWA not configured. Set SP_SITE_URL or PWA_URL env var.");
      const data = await pwaClient.getProjects(top, select, filter);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "pwa_get_tasks",
    "Get all tasks/schedule for a specific Project Online project. Returns task names, dates, durations, % complete, and hierarchy.",
    {
      projectId: z.string().describe("The Project GUID from PWA"),
      top: z.number().optional().describe("Max tasks to return (default 500)"),
      select: z.string().optional().describe("Comma-separated fields to return"),
    },
    async ({ projectId, top, select }) => {
      if (!pwaClient) throw new Error("PWA not configured.");
      const data = await pwaClient.getTasks(projectId, top, select);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "pwa_get_resources",
    "List all resources from the PWA resource pool. Returns names, emails, types, and IDs for resource mapping during migration.",
    {
      top: z.number().optional().describe("Max resources (default 500)"),
    },
    async ({ top }) => {
      if (!pwaClient) throw new Error("PWA not configured.");
      const data = await pwaClient.getResources(top);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "pwa_get_assignments",
    "Get resource assignments for a Project Online project. Shows who is assigned to which task with work/cost data.",
    {
      projectId: z.string().describe("The Project GUID from PWA"),
      top: z.number().optional().describe("Max assignments (default 500)"),
    },
    async ({ projectId, top }) => {
      if (!pwaClient) throw new Error("PWA not configured.");
      const data = await pwaClient.getAssignments(projectId, top);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "pwa_get_project_site_list",
    "Read a list (Risks, Issues, etc.) from a PWA project's associated SharePoint site. Each PWA project has a linked site containing these logs.",
    {
      projectSiteUrl: z.string().describe("The project site URL (e.g. https://contoso.sharepoint.com/sites/PWA/ProjectName)"),
      listTitle: z.string().describe("List name: 'Risks', 'Issues', 'Deliverables', etc."),
      top: z.number().optional().describe("Max items (default 200)"),
    },
    async ({ projectSiteUrl, listTitle, top }) => {
      if (!pwaClient) throw new Error("PWA not configured.");
      const data = await pwaClient.getProjectSiteList(projectSiteUrl, listTitle, top);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const toolCount = SP_SITE_URL ? "36" : "26";
  console.error(`OnePlan MCP server running on stdio (${toolCount} tools available)`);
  if (!SP_SITE_URL) {
    console.error("Tip: Set SP_SITE_URL to enable SharePoint/PWA migration tools.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
