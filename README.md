# Cívica MA — Eleições 2026 (v3)

Portal independente para consulta organizada de dados públicos eleitorais do Maranhão.

## O que há nesta versão

- dashboard estadual com métricas e distribuições descritivas;
- catálogo de candidaturas por cargo, partido, situação, busca e ordenação;
- página detalhada de candidatura;
- área de partidos e respectivas candidaturas por cargo;
- 217 municípios com ficha individual;
- zonas e seções por município, com resumo por zona;
- paginação para listas grandes;
- exportação CSV e Excel;
- impressão / geração de PDF pelo navegador;
- pesquisa global de municípios e candidaturas;
- status das fontes públicas;
- indicação separada de horário da consulta e atualização da fonte, quando disponível;
- cache com contingência em memória para a última resposta bem-sucedida;
- rotas amigáveis no Vercel;
- layout responsivo, navegação móvel e melhorias de acessibilidade.

## Fontes

- Candidaturas: TSE / DivulgaCandContas.
- Eleitorado, zonas e seções: Portal de Dados Abertos do TSE, recurso do Maranhão em “Perfil do eleitorado por seção eleitoral — 2026”.
- Municípios: lista dos 217 municípios do Maranhão e códigos IBGE usada apenas para navegação/localização.

O portal não é sistema oficial do TSE/TRE-MA e não apresenta projeções ou recomendações eleitorais.

## Vercel

O projeto deve usar **Framework Preset: Other**. O próprio `vercel.json` também define `"framework": null` para evitar autodetecção como servidor Node.

Não há `server.mjs` na raiz. O frontend é estático e as rotas em `api/` são Vercel Functions.

## Validação

```bash
npm run check
```

## Resiliência das fontes
A versão 3.1 possui fallback automático para os arquivos ZIP do CDN oficial do TSE quando os endpoints DivulgaCand/CKAN recusam chamadas server-side (por exemplo, HTTP 403 em provedores serverless). O navegador também mantém por até 24 horas a última resposta válida para contingência local, sempre sinalizada como dado em cache.

