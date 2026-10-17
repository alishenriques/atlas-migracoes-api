# atlas-migracoes-api

API GraphQL do **Atlas Migrações Leste-Sul**: plataforma de mapeamento dos artistas do Leste Europeu e da Áustria que migraram para o Brasil (contribuições da arte imigrante, 1918–1989), a partir do acervo do MAC USP. O MVP será apresentado na conferência de 10 a 12 de novembro de 2026.

Node + GraphQL Yoga + Drizzle ORM + Neon Postgres, com validação Zod. Roda na Vercel como função serverless, como a [alis-portfolio-api](https://github.com/alishenriques/alis-portfolio-api).

Arquitetura, convenções e roadmap do ecossistema: [`docs/ai`](https://github.com/alishenriques/atlas-migracoes/tree/main/docs/ai) no repositório principal. Mudanças grandes vão por PR detalhada e só entram na `main` com aprovação do Alisson.

## Ecossistema

| Repositório | Papel | Deploy |
|---|---|---|
| [atlas-migracoes](https://github.com/alishenriques/atlas-migracoes) | App público e área administrativa (Next.js App Router) | Vercel |
| [atlas-migracoes-api](https://github.com/alishenriques/atlas-migracoes-api) | API GraphQL, banco e importação das planilhas | Vercel (serverless) |
| [atlas-migracoes-design-system](https://github.com/alishenriques/atlas-migracoes-design-system) | Componentes React com a identidade do Atlas | npm via GitHub Actions |

**Custo zero é requisito.**

## Rodando

```bash
yarn install
cp .env.example .env
yarn dev          # http://localhost:4000/graphql
```

Sem `DATABASE_URL`, a API responde em **modo demonstração**: poucos registros simulados (`src/db/fallback.ts`), e `meta { source }` devolve `demo` para o app sinalizar isso. Nenhum dado real do acervo fica no repositório.

## Scripts

`yarn dev` · `yarn lint` · `yarn typecheck` · `yarn test` · `yarn db:generate` · `yarn db:migrate` · `yarn import:xlsx`

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | Connection string do Neon (opcional em dev; sem ela, modo demonstração) |
| `PORT` | Porta local (padrão 4000) |
| `CORS_ORIGIN` | Origem permitida, ou lista separada por vírgula (padrão `http://localhost:3000`) |

## Importando as planilhas

Os dados vêm de três exportações do CollectiveAccess do MAC USP (obras, exposições, publicações). Elas ficam na máquina de quem importa; `*.xlsx` está no `.gitignore` porque este repositório é público.

```bash
yarn import:xlsx --dir ~/atlas/planilhas --dry-run   # só valida e mostra o relatório
yarn db:migrate && yarn import:xlsx --dir ~/atlas/planilhas
```

- Cada aba é reconhecida pelos cabeçalhos (`Tombo`, `Título da exposição`, `Título da publicação`), não pelo nome do arquivo. Abas desconhecidas são ignoradas.
- Reimportar é seguro: registros são atualizados no lugar e coordenadas já preenchidas dos lugares nunca são sobrescritas.
- O relatório (também salvo em `import_batches`) traz contagens, referências a exposições/publicações que não estão nas planilhas e avisos de correção.

Regras de leitura, para que nada seja inventado:

| Dado | Como é lido |
|---|---|
| Datas | `FuzzyDate` com o texto original (`raw`) e a precisão: `day` (22/06/1946), `month` (03/1950), `year`, `circa` (c. 1949), `range` (1940-1945, 1940-45, década de 1950) ou `unknown` (s.d., desconhecida). Notas após `;` ficam só no `raw`. |
| Título e data | A célula `Titulo, Data` é dividida na última vírgula só se o final for uma data ou "s.d."; senão a vírgula é do título. |
| Lugares | Hierarquia `➔` sem o prefixo de continente; nomes históricos mantidos; `[atual X]` vai para `currentName`. Endereço colado no nome (ex.: `Santa Maria3960`) é removido com aviso. |
| Textos | Células com várias linhas viram uma linha, separadas por ` · `. |

Resultado com as planilhas de 16/07/2026: 31 artistas, 417 obras, 299 exposições, 108 publicações, 73 lugares; 11 exposições e 1 publicação citadas pelas obras não constam das planilhas.

## Consultas

Tudo é leitura no MVP; a edição por pesquisadores vem numa etapa seguinte do roadmap.

| Query | O que devolve |
|---|---|
| `meta { source }` | `database` ou `demo` |
| `stats` | Totais de artistas, obras, exposições, publicações, lugares e países de origem |
| `artists(filter: { originCountry, search })` | Artistas em ordem alfabética; `search` ignora acentos e maiúsculas |
| `artist(slug)` | Um artista com nascimento, morte, obras, exposições e publicações |
| `places` | Lugares com `lat`/`lng` (nulos até a geocodificação) |
| `exhibitions(placeId)` | Exposições, das mais antigas para as mais recentes |
| `work(id)` | Uma obra pelo tombo |

```graphql
{
  artist(slug: "artista-demo-a") {
    name
    birthPlace { label currentName lat lng }
    birthDate { raw year precision }
    exhibitions { title startDate { raw } place { label } }
  }
}
```
