# Deploy no Vercel

## Configuração recomendada

No projeto `tse-brasil`:

- Framework Preset: **Other**
- Root Directory: raiz do repositório
- Build Command: deixar vazio / automático
- Output Directory: deixar vazio / automático
- Install Command: automático

O arquivo `vercel.json` também define `"framework": null` para reforçar o preset `Other`.

## Atualização pelo GitHub

1. Substitua os arquivos do repositório pelos arquivos deste pacote.
2. Confirme que `server.mjs` foi removido.
3. Commit e push na branch `main`.
4. Aguarde o deploy automático do Vercel.
5. Se o Vercel reaproveitar configuração antiga, faça Redeploy sem cache.

## Rotas esperadas

- `/`
- `/candidatos`
- `/candidatos/{cargo}/{id}`
- `/partidos`
- `/partidos/{cargo}/{sigla}`
- `/zonas`
- `/municipios`
- `/municipios/{municipio}`
- `/fontes`

## APIs

- `/api/candidatos?cargo=6`
- `/api/secoes?municipio=Imperatriz`
- `/api/resumo`
- `/api/status`
- `/api/busca?q=nome`

## Checagem local de sintaxe

```bash
npm run check
```
