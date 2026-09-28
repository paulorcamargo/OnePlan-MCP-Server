# mcp-oneplan

Servidor MCP para o [OnePlan.ai](https://oneplan.ai). Dá a um agente de IA acesso às rotas de
planos, tipos de plano, campos, itens de cronograma, custos, recursos e financeiro — e, se você
configurar o SharePoint, também ao Project Online (PWA).

É um servidor **stdio local**: ele roda na sua máquina, iniciado pelo aplicativo que o usa, e fala
com o OnePlan pela API REST com a **sua** credencial.

## Antes de instalar, leia isto

**As ferramentas não são só de leitura.** Entre elas estão `oneplan_create_plan`,
`oneplan_update_plan`, `oneplan_change_plan_parent`, `oneplan_delete_field` e
`oneplan_create_resource`. Tudo o que você fizer por aqui acontece no tenant de verdade, na hora.

Dois pontos que não têm volta no OnePlan:

- **recurso criado não é deletável nem inativável** — não existe rota para desfazer;
- **campo de plano não é deletável** (campo de tarefa é).

O servidor **não** valida em qual tenant você está antes de escrever. Confira com
`oneplan_list_plans` — o `ConfigId` das linhas identifica o grupo — antes de qualquer criação ou
alteração.

## Instalação

Requer **Node 22 ou superior** (o `--env-file` usado na configuração depende disso).

```bash
git clone <url-deste-repositorio>
cd mcp-oneplan
npm install
npm run build
cp .env.example .env     # no Windows: copy .env.example .env
```

Depois abra o `.env` e preencha `ONEPLAN_API_KEY` e `ONEPLAN_KEY_NAME`. Os dois formam o Basic
auth e precisam bater exatamente com o que o OnePlan mostra.

**Peça as suas ao administrador do OnePlan** — a chave de API e o nome do grupo a que ela
pertence. Cada pessoa usa as próprias: é o que mantém o rastro de quem fez o quê, e o que permite
revogar o acesso de uma sem derrubar o de todas. Não reaproveite a credencial de outra pessoa, e
não cole a sua em conversa, ticket ou commit.

A chave é **escopada a um grupo**, e o grupo determina qual acervo você enxerga — por isso o nome
vem junto com ela, e não é um detalhe de formulário.

O `.env` está no `.gitignore` e não deve ser enviado para o repositório nem colado em conversa.

## Configuração por aplicativo

### Claude Code

Não precisa fazer nada: o `.mcp.json` já está no repositório. Ao abrir o projeto, o aplicativo
pergunta se você aprova o servidor — responda que sim, uma vez.

Se as ferramentas `mcp__oneplan__*` não aparecerem, o servidor não subiu. Um `.mcp.json` inválido
**não carrega e também não aparece na lista de servidores que falharam**, então a ausência das
ferramentas é o sintoma a procurar. Para ver o erro de verdade:

```bash
node --env-file=.env dist/index.js < /dev/null
```

Sem credencial ele encerra com `ONEPLAN_API_KEY environment variable is required`. Com credencial,
ele anuncia `OnePlan MCP server running on stdio (26 tools available)` e encerra em seguida, porque
o `< /dev/null` fecha a entrada — é o resultado esperado deste teste.

### Claude Desktop

O aplicativo de desktop **não lê o `.mcp.json` do projeto**. Acrescente o bloco abaixo ao seu
`claude_desktop_config.json`, com o **caminho absoluto** da sua cópia:

```jsonc
{
  "mcpServers": {
    "oneplan": {
      "command": "node",
      "args": [
        "--env-file=C:/caminho/para/mcp-oneplan/.env",
        "C:/caminho/para/mcp-oneplan/dist/index.js"
      ]
    }
  }
}
```

Use **barra normal** mesmo no Windows: em JSON, `\U` de `C:\Users` não é escape válido, o arquivo
deixa de ser JSON e o servidor simplesmente não existe para o aplicativo — sem nenhuma mensagem.

O caminho do arquivo de configuração:

| Sistema | Onde |
|---|---|
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |

Reinicie o aplicativo depois de salvar — servidor MCP sobe na abertura, não no meio da conversa.

## Conferir que funcionou

Peça a lista de planos (`oneplan_list_plans`) e confira se o `ConfigId` é o do seu grupo.

Duas coisas que economizam tempo: essa ferramenta **ignora o parâmetro `top`** e devolve o acervo
inteiro, o que pode ser alguns MB; e o feed OData do OnePlan **ignora `$filter`, `$select`,
`$skip` e `$top`**, paginando só por `odata.nextLink` — não confie em filtro feito pela URL.

## As ferramentas

São **28 sempre disponíveis** e mais **10 que só aparecem quando `SP_SITE_URL` está configurado**.
A lista abaixo sai dos registros do próprio `src/index.ts` — se divergir do que o seu aplicativo
mostra, o código manda.

### Planos

| Ferramenta | O que faz |
|---|---|
| `oneplan_list_plans` | Lista planos (projetos, ideias, programas), com filtro opcional por tipo. |
| `oneplan_get_plan` | Detalha um plano pelo id. É por aqui que vêm os campos personalizados: a listagem não os traz. |
| `oneplan_create_plan` | Cria um plano. |
| `oneplan_update_plan` | Altera as propriedades de um plano existente. |
| `oneplan_change_plan_parent` | Move o plano para outro portfólio ou programa. |
| `oneplan_list_plan_types` | Lista os tipos de plano e seus GUIDs. |
| `oneplan_get_plan_type` | Detalha um tipo de plano, por nome ou GUID. |

### Fluxo de aprovação

| Ferramenta | O que faz |
|---|---|
| `oneplan_list_steps` | Lista as etapas de fluxo disponíveis para um plano. |
| `oneplan_update_step` | Move o plano para frente ou para trás no fluxo. |
| `oneplan_approve_step` | Aprova a etapa atual. |

### Cronograma e itens de trabalho

| Ferramenta | O que faz |
|---|---|
| `oneplan_list_work_types` | Lista os tipos de trabalho (Tarefas, Riscos, Problemas, Mudanças e os personalizados) com o `WorkTypeId` de cada um. Consulte antes de criar item. |
| `oneplan_list_workplan_items` | Lista os itens de um plano, com o `WorkTypeId` que identifica o tipo. |
| `oneplan_create_work_item` | Cria item pelo protocolo de sincronismo do Gantt. Exige `WorkTypeId`. |
| `oneplan_upsert_workplan_item` | Cria ou atualiza item genérico na área de trabalho do plano. |

### Campos

| Ferramenta | O que faz |
|---|---|
| `oneplan_list_fields` | Lista os campos e o esquema. São **coleções separadas por nível** — `plan`, `task` e `resource` —, e existir num nível não diz nada sobre os outros: informe sempre o escopo que você quer. |
| `oneplan_create_field` | Cria campo. O padrão é lista; você passa os rótulos e os GUIDs são gerados. **Campo de plano não pode ser apagado depois** (só pela interface); campo de tarefa pode. Na dúvida, crie no escopo de tarefa. |
| `oneplan_update_field_name` | Troca o nome de exibição. O nome interno **não muda** — ele é derivado na criação, e é o que os relatórios usam. |
| `oneplan_upsert_field_choice` | Acrescenta opção a um campo de **plano**, preservando as existentes. |
| `oneplan_delete_field` | Apaga campo de tarefa ou de recurso. Recusa campo de plano, que não tem rota de exclusão, em vez de fingir que apagou. |

### Financeiro

| Ferramenta | O que faz |
|---|---|
| `oneplan_get_financials` | Lê o plano financeiro: orçamento, previsão e realizado. |
| `oneplan_upsert_financials` | Empurra dados financeiros externos para o plano — a ponte para integração com ERP. |
| `oneplan_upsert_cost_entry` | Insere ou atualiza um lançamento mensal na grade de custos, por mês e categoria. |

### Recursos e pessoas

| Ferramenta | O que faz |
|---|---|
| `oneplan_list_resources` | Lista usuários e recursos genéricos do diretório. |
| `oneplan_create_resource` | Cria usuário ou recurso genérico. **Não tem desfazer**: recurso no OnePlan não é deletável nem inativável. |
| `oneplan_get_my_tasks` | Traz as tarefas atribuídas a você, o "Meu Trabalho". |

### Administração

| Ferramenta | O que faz |
|---|---|
| `oneplan_get_audit_logs` | Quem mudou o quê, quando, e qual era o valor anterior. |
| `oneplan_check_integrations` | Estado das integrações de fundo (Jira, ADO, ServiceNow, OneConnect). |

### Primavera P6

| Ferramenta | O que faz |
|---|---|
| `p6_inspect_xer` | Abre um arquivo `.xer` **na máquina onde o servidor roda** e devolve o inventário: projetos com contagem de tarefas e EAP e janela de datas, rede por tipo de vínculo, calendários em uso, campos personalizados com quantos valores têm e exemplos, códigos de atividade e recursos com número de atribuições. **Só leitura — não importa nada.** |

Ela existe porque o de-para de um `.xer` para o OnePlan **muda a cada arquivo**, e errar grava valor
no campo errado em milhares de tarefas sem nenhum erro aparecer. O campo `avisos` da resposta
sinaliza o que costuma morder: vínculo entre projetos diferentes (o OnePlan só liga tarefas dentro
do mesmo plano, então esses não têm destino), custo com vírgula decimal, que pode ser peso unitário
e não dinheiro, e "recurso" que na verdade é um medidor — ponderador, HH, quantidade — e que você
não quer criar como pessoa.

### SharePoint e Project Online

Só aparecem com `SP_SITE_URL` configurado.

| Ferramenta | O que faz |
|---|---|
| `sp_get_site_info` | Título, URL e descrição do site. |
| `sp_get_lists` | Lista as listas visíveis do site. |
| `sp_list_fields` | Esquema de colunas de uma lista. |
| `sp_list_items` | Lê itens de qualquer lista. |
| `sp_list_subsites` | Descobre os subsites de uma coleção de sites. |
| `pwa_list_projects` | Lista os projetos do Project Online. |
| `pwa_get_tasks` | Traz o cronograma de um projeto. |
| `pwa_get_resources` | Lista o pool de recursos. |
| `pwa_get_assignments` | Atribuições de recurso de um projeto. |
| `pwa_get_project_site_list` | Lê uma lista (Riscos, Problemas…) do site associado ao projeto. |

## Variáveis de ambiente

| Variável | Obrigatória | Para quê |
|---|---|---|
| `ONEPLAN_API_KEY` | sim | chave de API |
| `ONEPLAN_KEY_NAME` | sim | nome da chave; vai junto no Basic auth |
| `ONEPLAN_BASE_URL` | não | padrão `https://mygraph.oneplan.ai` |
| `ONEPLAN_SESSION_COOKIE` | não | cookie do navegador; habilita rotas que a chave sozinha não alcança |
| `SP_SITE_URL` | não | ativa as ferramentas `sp_*` e `pwa_*` |
| `SP_AUTH_METHOD` | não | `app` (padrão), `cookie` ou `basic` |
| `SP_CLIENT_ID` · `SP_CLIENT_SECRET` · `SP_TENANT_ID` | não | aplicativo do Azure AD, quando o método é `app` |

## Desenvolvimento

`npm run build` compila `src/` para `dist/`; `npm run dev` recompila a cada alteração. Os
`import` do código usam extensão `.js` mesmo nos arquivos `.ts` — é exigência do ESM com
`moduleResolution: Node16`, não engano.
