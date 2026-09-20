# Correção de deploy no Vercel

O deploy anterior retornava `Arquivo não encontrado` porque o script `start` fazia o Vercel empacotar `server.mjs` como o servidor principal. Esse servidor tentava ler `index.html` e outros arquivos do filesystem em runtime, mas esses arquivos não faziam parte do bundle da função.

Nesta versão:

- `start` foi removido do `package.json` para impedir que o Vercel trate todo o site como um servidor Node;
- `index.html`, `assets/` e `data/` são servidos diretamente como arquivos estáticos pela Vercel CDN;
- `api/` continua sendo publicado como Vercel Functions;
- `/` é reescrito explicitamente para `/index.html`;
- `server.mjs` continua disponível apenas para desenvolvimento local via `npm run dev`.
