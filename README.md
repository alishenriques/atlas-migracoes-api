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

`yarn dev` · `yarn lint` · `yarn typecheck` · `yarn test` · `yarn test:coverage` · `yarn db:generate` · `yarn db:migrate` · `yarn import:xlsx` · `yarn geocode` · `yarn research:generate` · `yarn photos:import`

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | Connection string do Neon (opcional em dev; sem ela, modo demonstração) |
| `PORT` | Porta local (padrão 4000) |
| `CORS_ORIGIN` | Origem permitida, ou lista separada por vírgula (padrão `http://localhost:3000`) |
| `GEMINI_API_KEY` | Chave da API Gemini (plano gratuito), marcada como Sensitive na Vercel. Sem ela, a IA Relacional mostra os achados e o prompt, mas não o resumo |
| `GEMINI_LIVE` | `true` para a API pedir o resumo ao Gemini ao vivo quando o artista não tem pesquisa gravada. Padrão `false`: a cota grátis é por projeto do Google, e cada visita gastaria a cota da geração; os resumos gravados aparecem do mesmo jeito |
| `GEMINI_MODEL` | Modelo do resumo (padrão `gemini-flash-latest`, o Flash gratuito atual). Para a geração, `gemini-flash-lite-latest` tem cota diária maior no plano grátis |
| `CARTOGRAPHY_URL` | Fronteiras da Europa por período publicadas pelo app (padrão `https://atlas-migracoes.vercel.app/cartography/europe-states.geojson`); os nomes dos Estados por período são lidos do `state-names.json` na mesma pasta |

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
| Lugares | Hierarquia `➔` sem o prefixo de continente; nomes históricos mantidos; `[atual X]` vai para `currentName`. Endereço colado no nome (ex.: `Santa Maria3960`) é removido com aviso. País colado com o estado (`Estados Unidos da Illinois`) vira `Estados Unidos da América ➔ Illinois`, com aviso. |
| Textos | Células com várias linhas viram uma linha, separadas por ` · `. |

### Correções de lugares revisadas

Erros das planilhas que nenhuma regra distingue de um nome verdadeiro (uma grafia trocada, um nome atual que falta) vão numa tabela revisada por uma pessoa. Ela cita lugares do acervo, então fica ao lado das planilhas, fora deste repositório:

```json
[
  { "match": ["Áustria", "Vienna"], "path": ["Áustria", "Viena"] },
  { "match": ["Rússia", "Sebastopol"], "currentName": "Sebastopol, Ucrânia" }
]
```

```bash
yarn import:xlsx --dir ~/atlas/planilhas --corrections ~/atlas/correcoes-lugares.json
```

- `match` é o caminho como o importador o lê (sem continente e depois das correções automáticas). `path` troca o caminho, e `currentName` preenche o nome atual. Cada entrada precisa de pelo menos um dos dois.
- Cada correção aplicada aparece como aviso no relatório, e uma correção que não encontrou o lugar também.
- Trocar o caminho muda o id do lugar. A linha antiga fica no banco, sem nenhuma referência, e a API deixa de servi-la. As coordenadas não passam para o id novo: troque o `id` no arquivo de revisão do geocode e rode `--apply` de novo.
- O `yarn geocode --dir` aceita o mesmo `--corrections`.

Resultado com as planilhas de 16/07/2026: 31 artistas, 417 obras, 299 exposições, 108 publicações, 73 lugares; 11 exposições e 1 publicação citadas pelas obras não constam das planilhas.

## Geocodificando os lugares

As coordenadas são buscadas uma única vez no [Nominatim](https://nominatim.org/) (OpenStreetMap, gratuito), revisadas por uma pessoa e gravadas em `places`. O mapa nunca consulta o Nominatim ao vivo.

```bash
yarn geocode --dir ~/atlas/planilhas --out ~/atlas/lugares.geo.json   # busca e grava o arquivo de revisão
# revise o arquivo: confira displayName, corrija lat/lng e marque status "reviewed"
yarn geocode --apply ~/atlas/lugares.geo.json                          # grava no banco
```

- Respeita a política de uso do Nominatim: uma requisição por segundo e um User-Agent que identifica o projeto.
- Reexecutar só busca os lugares que ainda não estão no arquivo, então a revisão nunca se perde e uma execução interrompida continua de onde parou.
- `status`: `auto` (resultado do Nominatim, a conferir), `reviewed` (conferido) ou `not_found` (preencher à mão). Entradas sem coordenadas não são aplicadas e aparecem no resumo.
- Um erro HTTP interrompe a execução em vez de registrar "não encontrado".
- O arquivo de revisão tem nomes de lugares do acervo, por isso `*.geo.json` está no `.gitignore`.

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
| `research(slug)` | Pesquisa do artista em fontes abertas (Wikidata e Wikipedia): o item do Wikidata que é certamente o artista, os achados com a página de origem, confiabilidade e alertas de revisão, e o estado de cada fonte |

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

### Pesquisas geradas antes (para o evento)

Para o público não depender da cota grátis do Gemini, a pesquisa de cada artista é gerada antes e gravada na tabela `research_results`. A API lê dali primeiro e só pesquisa ao vivo os artistas que ainda não têm resultado, sem resumo do Gemini a menos que `GEMINI_LIVE=true`. Na sua máquina, com a `DATABASE_URL` do usuário dono do banco e a `GEMINI_API_KEY` no `.env`:

```bash
yarn db:migrate                          # cria a tabela research_results (uma vez)
yarn research:generate                   # pesquisa os artistas que ainda não têm resultado
yarn research:generate --slug lasar-segall --force   # refaz um artista
yarn research:generate --stale-period    # refaz só quem tem o mapa do período desatualizado
yarn research:generate --limit 15        # no máximo 15 chamadas ao Gemini nesta rodada
```

Cada linha da saída diz `stored`, `kept` (já estava gravado) ou `failed` (uma fonte ou o Gemini falhou; nada é gravado, e é só rodar de novo: só os que falharam são refeitos). Um artista que falha (um 503 do Gemini sobrecarregado, um timeout) é tentado mais 2 vezes, depois de 30 s e de 60 s (`--retries <n>`). Um `429` da cota diária do Gemini gratuito não é tentado de novo, e o script **para de chamar o Gemini** pelo resto da rodada (os artistas restantes saem como `skipped`), porque cada chamada a mais seria outra recusa; ele avisa no final para rodar outra vez depois que a cota renovar (meia-noite no horário do Pacífico), **sem `--force`**, para refazer só os que faltam (com `--force` ele refaz todos e gasta a cota com quem já estava gravado). A saída mostra qual cota o `429` atingiu (por exemplo `GenerateRequestsPerDayPerProjectPerModel-FreeTier`); um `429` da cota por minuto é tentado de novo depois da espera. `--limit <n>` limita as chamadas ao Gemini da rodada, tentativas incluídas. A cota é por projeto do Google, não por chave: a API em produção com uma chave do mesmo projeto gasta a mesma cota a cada artista sem resultado gravado que alguém abre. Na geração o Gemini tem até 60 s para responder; na API, 16 s. Há uma pausa de 6 s entre artistas (`--delay <ms>`) para ficar dentro do limite por minuto do plano gratuito. `summary: no_findings` não é falha: o Wikidata não tem uma pessoa que seja certamente o artista, e o Gemini nem é chamado. A data mostrada na tela (`retrievedAt`) é a da geração. Com `--stale-period`, um resultado gravado só é refeito quando o mapa do período que ele guarda (`period`) difere do que as fronteiras e os nomes publicados pelo app dão hoje (por exemplo, depois de uma mudança em `state-names.json`); os artistas sem resultado também entram, e repetir o comando depois de um `429` continua de onde parou. Se a API usar um usuário só de leitura, ele precisa de `SELECT` nessa tabela também (`GRANT SELECT ON research_results TO <usuário>`).

### Fotos dos artistas

As fotos ficam no banco (tabela `artist_photos`), nunca neste repositório público. Cada artista tem `photo { url credit sourceUrl }` na API, e a imagem é servida em `GET /photos/<slug>?v=<hash>`. O `hash` muda junto com a foto, então a resposta pode ficar em cache por um ano. Sem foto, `photo` é `null`, e o modo demo não tem fotos. Para gravar fotos, rode na sua máquina, com a `DATABASE_URL` do usuário dono do banco:

```bash
yarn db:migrate                          # cria a tabela artist_photos (uma vez)
yarn photos:import --dir ~/atlas/fotos   # grava cada <slug>.webp|jpg|png da pasta
```

O nome do arquivo é o slug do artista (`anatol-wladyslaw.webp`). Um `photos.json` opcional na mesma pasta dá o crédito de cada foto (`{ "anatol-wladyslaw": { "credit": "…", "sourceUrl": "https://…" } }`). Sem ele o crédito fica nulo e não é inventado. Gravar de novo um slug troca a foto. Arquivos que não são JPEG, PNG ou WebP de verdade, e slugs sem artista, são listados e ficam de fora. A migração dá `SELECT` na tabela ao usuário `atlas_api_readonly` quando ele existe.

### Vínculos revisados com o Wikidata

Quando a busca não acha o artista com certeza, a pesquisa grava as pistas (pessoas que o Wikidata devolveu e por que não foram ligadas). Um pesquisador confere cada pista e registra a decisão numa lista revisada, que fica na máquina que roda a geração, como as correções de lugares, e **nunca no repositório**:

```json
{
  "artista-a": { "confirmed": "Q123", "note": "No Wikidata sem o nome do meio; mesma data de nascimento." },
  "artista-b": { "rejected": ["Q456"], "note": "Homônima de outro país, outra pessoa." }
}
```

```bash
yarn research:generate --links ~/atlas/vinculos-wikidata.json
```

- `confirmed`: o item é usado direto, sem busca, e a tela diz que o vínculo foi conferido por um pesquisador, com a nota (`match.basis = reviewed`, `match.note`).
- `rejected`: esses itens nunca são ligados ao artista nem aparecem como pistas, mesmo que a busca os encontre de novo.
- Com `--links`, cada artista cujo resultado gravado ainda não segue a lista é refeito, mesmo sem `--force`; os outros ficam como estão. Um slug que não existe na base é erro, não é ignorado. A API em produção não lê a lista: ela só serve o que a geração gravou.

### Limites por requisição

A API é pública, então cada requisição tem limites (`src/graphql/limits.ts`, com graphql-armor): profundidade 8, até 10 aliases, 2000 tokens e custo 5000, e **uma só pesquisa (`research`) por requisição**, para que aliases ou fragments não disparem a pesquisa de todos os artistas de uma vez e esgotem a cota grátis do Gemini. As operações do app (`src/test/appOperations.ts`, cópia de `atlas-migracoes/src/lib/atlas.ts`) ficam bem abaixo disso, e um teste garante que continuem aceitas. Em produção a página do GraphiQL fica desligada. Cada instância guarda a base carregada por 5 minutos, em vez de ler as sete tabelas a cada requisição.

### Pesquisa em fontes abertas (IA Relacional)

`research(slug)` procura o artista no Wikidata e só aceita um item quando ele é certamente o artista: a única pessoa nascida no ano do acervo (com "c." vale dois anos para cada lado) ou, sem ano no acervo, a única pessoa com exatamente o mesmo nome. Sem certeza, não há achados (`match: null`, fonte `no_match`), mas a pesquisa registra o que viu, para orientar o pesquisador: os nomes buscados (`searchedNames`: o do acervo e, quando ele tem nomes do meio, só o primeiro e o último) e até cinco pessoas que o Wikidata devolveu (`candidates`), cada uma com o motivo de não ter sido vinculada (`birth_year_differs`, `no_birth_year`, `ambiguous`, `shorter_name`, `name_differs`). Um candidato é uma pista, nunca um achado: quem aparece só pelo nome mais curto nunca é vinculado automaticamente. Cada achado guarda a página de onde veio; afirmações do Wikidata com referência são `documented`, sem referência e texto da Wikipedia são `undetermined`. Lugares e países vêm com o nome de hoje e levam o alerta `present_day_name`; datas que discordam do acervo levam `conflicts_with_collection`. Nada disso é gravado na base. As respostas ficam em cache por um dia em cada instância.

```graphql
{
  research(slug: "lasar-segall") {
    match { id label url basis }
    findings { property value sourceUrl reliability reviews }
    sources { source status detail }
    period { day approximate birthState states }
    summary { status text citations prompt model detail }
  }
}
```

**Resumo com IA (Gemini).** Com uma pessoa encontrada e achados, a API monta o prompt: as instruções (resumir só com os achados, citar cada afirmação como `[n]`, raciocinar só com a geopolítica do período, tratar o texto dos achados como dado), o registro do acervo, o mapa da Europa em 1º de julho do ano de nascimento (o Estado que continha o local de nascimento e a lista de Estados daquele dia, lidos do mesmo arquivo CShapes 2.0 da Camada Histórica, cada Estado com o nome que tinha naquele dia, do `state-names.json` do app: Império Russo, não "Russia (Soviet Union)") e os achados numerados. O prompt inteiro volta em `summary.prompt`. O texto só é mostrado (`ok`) quando cita pelo menos um achado e todas as citações existem; senão fica `rejected`. Sem chave, `not_configured` (o prompt aparece mesmo assim). Uma falha (de uma fonte ou do Gemini, `error`) fica em cache só por 5 minutos: a próxima visita depois disso tenta de novo, sem que cada visualização peça outra vez enquanto o Gemini responde 429.
