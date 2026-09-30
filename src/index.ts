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

const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

// Plan fields shown in the list_plans summary, resolved to their choice labels
const PLAN_STATUS_FIELDS = ["State", "Status", "StatusdoProjeto"];

// ---------------------------------------------------------------------------
// Tool: List Plans
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_list_plans",
  "List plans (projects, ideas, programs) from OnePlan. Optionally filter by plan type. Returns a summary per plan (Id, Name, PlannerTypeId, PortfolioParentId, Archived and the status fields with their labels); use oneplan_get_plan for all fields.",
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
    const plans = (await client.listPlans({ planTypeId, top, skip })) as any[];

    // Status fields hold choice GUIDs; look up their labels once
    const statusChoices = new Map<string, Record<string, string>>();
    try {
      for (const f of (await client.listFields("plan")) as any[]) {
        if (PLAN_STATUS_FIELDS.includes(f.InternalName)) statusChoices.set(f.InternalName, f.Choices ?? {});
      }
    } catch { /* fall back to raw GUIDs */ }

    const data = plans.map((p) => {
      const summary: Record<string, unknown> = {
        Id: p.id,
        Name: p.Name,
        PlannerTypeId: p.PlannerTypeId,
        PortfolioParentId: p.PortfolioParentId === EMPTY_GUID ? null : p.PortfolioParentId,
        Archived: p.Archived,
      };
      for (const field of PLAN_STATUS_FIELDS) {
        const value = p.Fields?.[field];
        if (value != null) summary[field] = statusChoices.get(field)?.[value] ?? value;
      }
      return summary;
    });
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
  "Approve or reject a stage-gate approval task. OnePlan gates a workflow step through an approval task (work type 'Aprovações'); find its Id with oneplan_list_workplan_items.",
  {
    taskId: z.string().describe("GUID of the approval task"),
    comment: z.string().optional().describe("Approval or rejection reason"),
    reject: z.boolean().optional().describe("true to reject instead of approve"),
  },
  async ({ taskId, comment, reject }) => {
    const data = await client.decideApprovalTask(taskId, !reject, comment);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: List Plan Types
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_list_plan_types",
  "List all plan types in OnePlan with their GUID, name and parent type. Use oneplan_get_plan_type for a type's full definition.",
  {},
  async () => {
    const data = (await client.listPlanTypes()).map((t) => ({
      Id: t.id,
      Name: t.Name,
      ParentTypeId: t.ParentTypeId === EMPTY_GUID ? null : t.ParentTypeId,
      Hidden: t.Hidden,
    }));
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
    const { Id, id, Name, WorkTypeId, ...fields } = payload as Record<string, any>;
    const itemId = Id ?? id;
    let data: unknown;
    if (itemId) {
      data = await client.updateWorkItem(planId, itemId, {
        ...fields,
        ...(Name !== undefined ? { Name } : {}),
        ...(WorkTypeId !== undefined ? { WorkTypeId } : {}),
      });
    } else {
      if (!Name || !WorkTypeId) {
        return {
          content: [{ type: "text", text: "To create an item, payload needs Name and WorkTypeId (see oneplan_list_work_types)." }],
          isError: true,
        };
      }
      data = await client.createWorkItem(planId, WorkTypeId, Name, fields);
    }
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
    costTypeId: z.string().describe("Cost type GUID (Budget, Actuals, Forecast…). The ids differ per tenant: read them with oneplan_get_financials"),
    costCategoryId: z.string().describe("Leaf cost category GUID. The ids differ per tenant and per cost type: read them with oneplan_get_financials"),
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
  "Fetch the users and generic resources in the OnePlan directory: Id, UserId, name, email, job title, role and status, so you can assign items to people.",
  {},
  async () => {
    const resources = (await client.listResources()) as any[];

    // Role holds a choice GUID; look up its label
    let roles: Record<string, string> = {};
    try {
      const fields = (await client.listFields("resource")) as any[];
      roles = fields.find((f) => f.InternalName === "Role")?.Choices ?? {};
    } catch { /* fall back to the raw GUID */ }

    const data = resources.map((r) => ({
      Id: r.id,
      UserId: r.userid,
      Name: r.name,
      Email: r.Fields?.mail ?? r.Fields?.userPrincipalName ?? null,
      JobTitle: r.Fields?.jobTitle ?? null,
      Role: r.Fields?.Role ? roles[r.Fields.Role] ?? r.Fields.Role : null,
      Generic: r.Generic,
      Inactive: r.Inactive,
      CanLogin: r.CanLogin,
    }));
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
  "Read a plan's Cost Planner grid (budget, forecast, actuals and the other cost types) by cost category and period. Without costTypeId it reads every cost type and returns only those that have values. Rows and periods with no value are left out.",
  {
    planId: z.string().describe("The GUID of the Plan"),
    costTypeId: z
      .string()
      .optional()
      .describe("Cost type GUID (from /api/portfolio/costtypes, e.g. Orçamento). Omit to read all cost types"),
    start: z.string().optional().describe("First date, YYYY-MM-DD (default 2020-01-01)"),
    end: z.string().optional().describe("Last date, YYYY-MM-DD (default 2035-12-31)"),
    zoom: z.number().optional().describe("Period size: 2 = monthly (default)"),
  },
  async ({ planId, costTypeId, start = "2020-01-01", end = "2035-12-31", zoom = 2 }) => {
    const allTypes = await client.listCostTypes();
    const types = costTypeId
      ? allTypes.filter((t) => t.id.toLowerCase() === costTypeId.toLowerCase())
      : allTypes;
    if (types.length === 0) {
      return { content: [{ type: "text", text: `Cost type ${costTypeId} not found.` }], isError: true };
    }

    const withValues: unknown[] = [];
    const empty: string[] = [];
    for (const type of types) {
      const grid = await client.getCostGrid(planId, type.id, start, end, zoom);
      const prefix = type.id.replace(/-/g, "") + "_";
      const rows: Record<string, unknown>[] = [];
      let total = 0;

      // Walk the category tree; keep rows that carry at least one value
      const walk = (nodes: any[], path: string[], depth: number) => {
        for (const node of nodes ?? []) {
          const nodePath = depth === 0 ? path : [...path, node.Name];
          const periods: Record<string, number> = {};
          let rowTotal: number | undefined;
          for (const [key, value] of Object.entries(node)) {
            if (!key.startsWith(prefix) || typeof value !== "number" || value === 0) continue;
            const period = key.slice(prefix.length);
            if (period === "Total") rowTotal = value;
            else periods[period] = value;
          }
          if (depth === 0) total = rowTotal ?? 0; // "Plan Total" row
          else if (rowTotal !== undefined || Object.keys(periods).length > 0) {
            rows.push({
              Category: nodePath.join(" > "),
              CostCategoryId: node.CostCategoryId,
              ...(node.DetailRow ? { DetailRow: true } : {}),
              Total: rowTotal ?? 0,
              Periods: periods,
            });
          }
          walk(node.children, nodePath, depth + 1);
        }
      };
      walk(grid.children ?? [], [], 0);

      if (rows.length > 0 || total !== 0) {
        withValues.push({ CostTypeId: type.id, CostType: type.Name, Total: total, Rows: rows });
      } else {
        empty.push(`${type.Name} (${type.id})`);
      }
    }

    const data = { planId, start, end, costTypes: withValues, costTypesWithoutValues: empty };
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
  "Read the audit trail (who changed what, when, and the previous value), the same data as OnePlan's Audit window. Returns at most 100 entries. An empty list can also mean auditing is not enabled for the tenant.",
  {
    planId: z.string().optional().describe("Plan GUID to limit the audit to one plan"),
    area: z
      .enum(["plan", "tasks", "financials"])
      .optional()
      .describe("'plan' = plan fields (default), 'tasks' = work items, 'financials' = cost planner"),
    start: z.string().optional().describe("First date, YYYY-MM-DD (default: 30 days ago)"),
    end: z.string().optional().describe("Last date, YYYY-MM-DD (default: tomorrow)"),
    userId: z.string().optional().describe("Only changes made by this user GUID"),
    field: z.string().optional().describe("Only changes to this field InternalName"),
  },
  async ({ planId, area = "plan", start, end, userId, field }) => {
    const day = 24 * 60 * 60 * 1000;
    const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const data = await client.getAuditLogs({
      area,
      planId,
      start: start ?? isoDate(Date.now() - 30 * day),
      end: end ?? isoDate(Date.now() + day),
      userId,
      field,
    });
    return { content: [{ type: "text", text: JSON.stringify(data.slice(0, 100), null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: Check Integrations Status
// ---------------------------------------------------------------------------
server.tool(
  "oneplan_check_integrations",
  "List the integrations configured in OnePlan (Planner, Jira, Azure DevOps, Teams, SharePoint…). Pass planId to also get each integration's sync status for that plan.",
  {
    planId: z.string().optional().describe("Plan GUID to check the sync status for"),
  },
  async ({ planId }) => {
    const data = await client.checkIntegrations(planId);
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
    // The API answers with the whole remaining field list; deleteField already
    // re-reads it to confirm the removal, so report just the outcome.
    await client.deleteField(fieldIdentifier, scope);
    return { content: [{ type: "text", text: JSON.stringify({ deleted: fieldIdentifier, scope, confirmed: true }, null, 2) }] };
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
// Tool: Inspect a Primavera P6 .xer file
// ---------------------------------------------------------------------------
server.tool(
  "p6_inspect_xer",
  "Read a Primavera P6 .xer file from disk and return an inventory of it: projects with task and WBS counts and date ranges, dependency totals by type, calendars actually in use, user-defined fields with fill counts and sample values, activity code types, and resources with assignment counts. READ-ONLY — it imports nothing. Use it before any import, because the field mapping into OnePlan differs per file and guessing writes values into the wrong field: the same .xer may carry the client's own enterprise fields under P6 names, two disagreeing sources for one field, cross-project links that have no destination in OnePlan (links exist only within a plan), and 'resources' that are really unit-weight metrics rather than people. The returned `avisos` array flags these. The file path must be local to the machine running this server.",
  {
    filePath: z.string().describe("Absolute path to the .xer file on the machine running this server"),
  },
  async ({ filePath }) => {
    const { inventariar } = await import("./xer.js");
    const inventario = inventariar(filePath);
    return { content: [{ type: "text", text: JSON.stringify(inventario, null, 2) }] };
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

  // Contagem conferida com `node extrair-ferramentas.mjs`, que le os registros do proprio arquivo.
  // Ao acrescentar ou remover ferramenta, rode-o de novo e ajuste aqui e na tabela do README.
  const toolCount = SP_SITE_URL ? "38" : "28";
  console.error(`OnePlan MCP server running on stdio (${toolCount} tools available)`);
  if (!SP_SITE_URL) {
    console.error("Tip: Set SP_SITE_URL to enable SharePoint/PWA migration tools.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
