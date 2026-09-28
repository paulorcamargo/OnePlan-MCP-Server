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

Depois abra o `.env` e preencha `ONEPLAN_API_KEY` e `ONEPLAN_KEY_NAME`. Os dois formam o Basic auth
e precisam bater exatamente com o que o OnePlan mostra. **Use a sua própria chave**, criada em
`my.oneplan.ai`: assim o rastro de quem fez o quê se mantém, e revogar a sua não derruba as outras
pessoas.

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
