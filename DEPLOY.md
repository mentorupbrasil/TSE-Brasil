# Deploy no Vercel

1. Extraia o ZIP na raiz do repositório `TSE-Brasil`.
2. Confirme no Vercel: **Settings → Build and Deployment → Framework Preset → Other**.
3. Faça commit e push no `main`.
4. Aguarde o deploy de produção.

## Rotas

- `/` — visão geral
- `/candidatos`
- `/partidos`
- `/zonas`
- `/bairros`
- `/municipios`
- `/base` — base privada no navegador
- `/lancamentos` — lançamentos manuais
- `/fontes`

A rota antiga `/simulacao` é mantida apenas como compatibilidade e é convertida para `/lancamentos` no navegador.

## Dados territoriais

A leitura de zonas/seções/locais usa processamento em fluxo do ZIP oficial do TSE para reduzir consumo de memória na função serverless. A primeira consulta territorial pode demorar mais; as seguintes aproveitam cache.

## Dados privados

Nunca coloque `Eleitores.xlsx`, CSV de pessoas, backup do cofre ou qualquer arquivo com CPF/nascimento no repositório público. Importe o CSV pela tela **Base de pessoas** depois do site carregado.
