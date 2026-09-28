/**
 * Leitor de arquivo .xer do Primavera P6 — SOMENTE LEITURA.
 *
 * Existe para dar ao agente o inventario de um cronograma do P6 antes de qualquer importacao:
 * quais projetos, quantas tarefas, que campos, que calendarios, que rede. O de-para para o OnePlan
 * NAO e feito aqui, de proposito — ele muda a cada arquivo, e decidi-lo sem olhar o dado e o que
 * grava valor no campo errado em milhares de tarefas.
 *
 * Formato: blocos delimitados por tabulacao. `%T` abre a tabela, `%F` lista os campos, `%R` e uma
 * linha de dados.
 */
import fs from "node:fs";

/**
 * O XER e cp1252, NAO latin1. Os bytes 0x80-0x9F sao imprimiveis em cp1252 (0x96 e um travessao)
 * e caracteres de CONTROLE invisiveis em latin1. Lido errado, o travessao vira U+0096: o texto
 * parece certo na tela e nao casa com nada — foi o que derrubou um de-para de calendario inteiro.
 */
const CP1252: Record<number, string> = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†",
  0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ",
  0x8e: "Ž", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•",
  0x96: "–", 0x97: "—", 0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›",
  0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};

export type Linha = Record<string, string>;
export type Tabelas = Record<string, Linha[]>;

export function lerXer(caminho: string): Tabelas {
  const bruto = fs.readFileSync(caminho, "latin1")
    .replace(/[\u0080-\u009f]/g, (c) => CP1252[c.charCodeAt(0)] ?? c);
  const cru: Record<string, { campos: string[]; linhas: string[][] }> = {};
  let atual: string | null = null;
  for (const l of bruto.split(/\r?\n/)) {
    if (l.startsWith("%T\t")) { atual = l.split("\t")[1]; cru[atual] = { campos: [], linhas: [] }; }
    else if (l.startsWith("%F\t") && atual) cru[atual].campos = l.split("\t").slice(1);
    else if (l.startsWith("%R\t") && atual) cru[atual].linhas.push(l.split("\t").slice(1));
  }
  const out: Tabelas = {};
  for (const [nome, t] of Object.entries(cru))
    out[nome] = t.linhas.map((r) => Object.fromEntries(t.campos.map((c, i) => [c, r[i]])));
  return out;
}

// O XER traz campo ausente como string VAZIA, nao null: `??` nao cai para o padrao, `||` cai.
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const contar = <T>(itens: T[], chave: (x: T) => string | undefined) => {
  const c: Record<string, number> = {};
  for (const x of itens) { const k = chave(x); if (k !== undefined && k !== "") c[k] = (c[k] ?? 0) + 1; }
  return c;
};

export interface InventarioXer {
  arquivo: string;
  tabelas: Record<string, number>;
  projetos: Array<{
    proj_id: string; codigo: string; nome: string;
    tarefas: number; marcos: number; nosEap: number; nosEapComTarefa: number;
    inicio: string | null; termino: string | null;
    comPercentualFisico: number; concluidas: number; comRestricao: number;
  }>;
  dependencias: { total: number; porTipo: Record<string, number>; comDefasagem: number; entreProjetosDiferentes: number };
  calendarios: Array<{ nome: string; tarefas: number }>;
  camposUdf: Array<{ rotulo: string; tipo: string; nivel: string; preenchidos: number; exemplos: string[] }>;
  codigosAtividade: Array<{ tipo: string; opcoes: number; tarefasMarcadas: number; exemplos: string[] }>;
  recursos: Array<{ codigo: string; nome: string; tipo: string; atribuicoes: number; somaQuantidade: number }>;
  avisos: string[];
}

export function inventariar(caminho: string): InventarioXer {
  const T = lerXer(caminho);
  const tb = (n: string) => T[n] ?? [];
  const WBS = tb("PROJWBS"), TK = tb("TASK"), PRED = tb("TASKPRED"), CAL = tb("CALENDAR");
  const RSRC = tb("RSRC"), TRSRC = tb("TASKRSRC");
  const UDFT = tb("UDFTYPE"), UDFV = tb("UDFVALUE");
  const ACTVT = tb("ACTVTYPE"), ACTVC = tb("ACTVCODE"), TACTV = tb("TASKACTV");
  const avisos: string[] = [];

  const paiDe = Object.fromEntries(WBS.map((w) => [w.wbs_id, w.parent_wbs_id]));
  const tarefasDe: Record<string, Linha[]> = {};
  for (const t of TK) (tarefasDe[t.proj_id] ??= []).push(t);

  // O nome de verdade do projeto mora no no RAIZ da EAP (proj_node_flag = Y), nao na tabela PROJECT.
  const projetos = WBS.filter((w) => w.proj_node_flag === "Y").map((raiz) => {
    const minhas = tarefasDe[raiz.proj_id] ?? [];
    const comTarefa = new Set<string>();
    for (const t of minhas) { let x = t.wbs_id; while (x) { comTarefa.add(x); x = paiDe[x]; } }
    const datas = (campo: string) => minhas.map((t) => t[campo]).filter(Boolean).sort();
    return {
      proj_id: raiz.proj_id, codigo: raiz.wbs_short_name, nome: raiz.wbs_name,
      tarefas: minhas.length,
      marcos: minhas.filter((t) => /Mile/.test(t.task_type ?? "")).length,
      nosEap: WBS.filter((w) => w.proj_id === raiz.proj_id && w.proj_node_flag !== "Y").length,
      nosEapComTarefa: WBS.filter((w) => w.proj_id === raiz.proj_id && w.proj_node_flag !== "Y" && comTarefa.has(w.wbs_id)).length,
      inicio: datas("target_start_date")[0] ?? null,
      termino: datas("target_end_date").at(-1) ?? null,
      comPercentualFisico: minhas.filter((t) => num(t.phys_complete_pct) > 0).length,
      concluidas: minhas.filter((t) => t.status_code === "TK_Complete").length,
      comRestricao: minhas.filter((t) => (t.cstr_type ?? "") !== "").length,
    };
  });
  const semTarefa = projetos.filter((p) => !p.tarefas).length;
  if (semTarefa) avisos.push(`${semTarefa} projeto(s) sem tarefa nenhuma — nao viram plano.`);

  const projDe = Object.fromEntries(TK.map((t) => [t.task_id, t.proj_id]));
  const entre = PRED.filter((p) => projDe[p.task_id] !== projDe[p.pred_task_id]).length;
  if (entre) avisos.push(`${entre} vinculo(s) ligam tarefas de projetos DIFERENTES. O OnePlan so liga tarefas dentro do mesmo plano: nao ha destino para eles.`);

  const nomeCal = Object.fromEntries(CAL.map((c) => [c.clndr_id, c.clndr_name]));
  const usoCal = contar(TK, (t) => nomeCal[t.clndr_id]);
  const calendarios = Object.entries(usoCal).sort((a, b) => b[1] - a[1]).map(([nome, tarefas]) => ({ nome, tarefas }));
  if (calendarios.length) avisos.push(`Calendario exige de-para SEMANTICO para o OnePlan: os nomes nao casam por texto.`);

  const rotuloUdf = Object.fromEntries(UDFT.map((u) => [u.udf_type_id, u]));
  const porUdf: Record<string, string[]> = {};
  for (const v of UDFV) {
    const u = rotuloUdf[v.udf_type_id]; if (!u) continue;
    const valor = v.udf_text || v.udf_number || v.udf_date || "";
    if (valor !== "") (porUdf[u.udf_type_id] ??= []).push(String(valor));
  }
  const camposUdf = UDFT.map((u) => ({
    rotulo: u.udf_type_label, tipo: u.logical_data_type, nivel: u.table_name,
    preenchidos: (porUdf[u.udf_type_id] ?? []).length,
    exemplos: [...new Set(porUdf[u.udf_type_id] ?? [])].slice(0, 3).map((x) => x.slice(0, 80)),
  })).sort((a, b) => b.preenchidos - a.preenchidos);

  const tipoDe = Object.fromEntries(ACTVT.map((x) => [x.actv_code_type_id, x.actv_code_type]));
  const codigoDe = Object.fromEntries(ACTVC.map((x) => [x.actv_code_id, x]));
  const usoPorTipo = contar(TACTV, (x) => tipoDe[codigoDe[x.actv_code_id]?.actv_code_type_id]);
  const codigosAtividade = ACTVT.map((t) => {
    const ops = ACTVC.filter((c) => c.actv_code_type_id === t.actv_code_type_id);
    return {
      tipo: t.actv_code_type, opcoes: ops.length,
      tarefasMarcadas: usoPorTipo[t.actv_code_type] ?? 0,
      exemplos: ops.slice(0, 5).map((o) => o.actv_code_name),
    };
  }).sort((a, b) => b.tarefasMarcadas - a.tarefasMarcadas);

  const atribuicoes = contar(TRSRC, (a) => a.rsrc_id);
  const soma: Record<string, number> = {};
  for (const a of TRSRC) soma[a.rsrc_id] = (soma[a.rsrc_id] ?? 0) + num(a.target_qty);
  const recursos = RSRC.map((r) => ({
    codigo: r.rsrc_short_name, nome: r.rsrc_name, tipo: r.rsrc_type,
    atribuicoes: atribuicoes[r.rsrc_id] ?? 0,
    somaQuantidade: Math.round((soma[r.rsrc_id] ?? 0) * 100) / 100,
  })).sort((a, b) => b.atribuicoes - a.atribuicoes);
  if (recursos.some((r) => r.atribuicoes))
    avisos.push(`Confira se os "recursos" sao gente ou MEDIDORES (ponderador, HH, quantidade) antes de cria-los: recurso no OnePlan nao e deletavel nem inativavel.`);
  if (TRSRC.some((a) => /,/.test(a.target_cost ?? "")))
    avisos.push(`Ha custo com VIRGULA decimal em target_cost — confira se e dinheiro ou peso unitario antes de tratar como custo.`);

  return {
    arquivo: caminho,
    tabelas: Object.fromEntries(Object.entries(T).map(([k, v]) => [k, v.length])),
    projetos: projetos.sort((a, b) => b.tarefas - a.tarefas),
    dependencias: {
      total: PRED.length,
      porTipo: contar(PRED, (p) => p.pred_type),
      comDefasagem: PRED.filter((p) => num(p.lag_hr_cnt) !== 0).length,
      entreProjetosDiferentes: entre,
    },
    calendarios, camposUdf, codigosAtividade, recursos, avisos,
  };
}
