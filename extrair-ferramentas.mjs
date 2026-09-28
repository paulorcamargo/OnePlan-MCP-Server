/** Extrai nome e descricao de cada ferramenta registrada em src/index.ts, para a tabela do README. */
import fs from "node:fs";
const s = fs.readFileSync("src/index.ts", "utf8");
const re = /server\.tool\(\s*\n\s*"([a-z0-9_]+)",\s*\n\s*"((?:[^"\\]|\\.)*)"/g;
const linhas = [];
let m;
while ((m = re.exec(s))) linhas.push([m[1], m[2].replace(/\\"/g, '"').replace(/\\n/g, " ")]);
fs.writeFileSync("ferramentas.json", JSON.stringify(linhas, null, 1));
console.log(`ferramentas: ${linhas.length}`);
for (const [nome, d] of linhas) console.log(nome.padEnd(30), d.split(". ")[0].slice(0, 95));
