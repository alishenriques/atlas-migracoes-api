# atlas-migracoes-api

Plataforma de mapeamento dos artistas do Leste Europeu e da Áustria que migraram para o Brasil: contribuições da arte imigrante, 1918–1989. Projeto Migrações Leste-Sul, a partir do acervo do MAC USP. O MVP será apresentado na conferência de 10 a 12 de novembro de 2026.

API GraphQL do Atlas: consulta e manutenção da base de artistas, obras, exposições, publicações e fontes, e importação das planilhas do acervo.

## Ecossistema

| Repositório | Papel | Deploy |
|---|---|---|
| [atlas-migracoes](https://github.com/alishenriques/atlas-migracoes) | App público e área administrativa (Next.js App Router) | Vercel |
| [atlas-migracoes-api](https://github.com/alishenriques/atlas-migracoes-api) | API GraphQL, banco de dados e importação das planilhas | Vercel (serverless) |
| [atlas-migracoes-design-system](https://github.com/alishenriques/atlas-migracoes-design-system) | Biblioteca de componentes React com a identidade do Atlas | npm via GitHub Actions |

A arquitetura segue o ecossistema do [alis-portfolio](https://github.com/alishenriques/alis-portfolio). **Custo zero é requisito.**

## Status

Repositório recém-criado. A estrutura, a documentação (`docs/ai/`) e o CI chegam na etapa 1 do roadmap, a partir de 20/10/2026, por PR revisada pelo Alisson.
