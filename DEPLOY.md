# Deploy no Vercel

1. Extraia o ZIP na raiz do repositório `TSE-Brasil`.
2. Confirme no Vercel: **Settings → Build and Deployment → Framework Preset → Other**.
3. Faça commit e push no `main`.
4. Aguarde o deploy de produção.

## Rotas

- `/` — início
- `/candidatos`
- `/zonas`
- `/municipios`
- `/base` — base privada no navegador

Rotas antigas (`/partidos`, `/bairros`, `/fontes`, `/lancamentos`, `/simulacao`) abrem o início no navegador.

## Dados territoriais

A leitura de zonas/seções/locais usa processamento em fluxo do ZIP oficial do TSE para reduzir consumo de memória na função serverless. A primeira consulta territorial pode demorar mais; as seguintes aproveitam cache.

## Dados privados

Nunca coloque `Eleitores.xlsx`, CSV de pessoas, backup do cofre ou qualquer arquivo com CPF/nascimento no repositório público. Importe o CSV pela tela **Base de pessoas** depois do site carregado.
