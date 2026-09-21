# Cívica MA — Eleições 2026

Portal independente para consulta organizada de dados públicos eleitorais do Maranhão.

## V5 — principais módulos

- Candidaturas por cargo, partido e situação, com busca e exportação.
- Partidos e fichas de candidatura.
- Municípios do Maranhão.
- Zonas, seções, bairros e locais de votação por município.
- Painel de **Lançamentos** manuais, com um registro por vez e resumos territoriais.
- **Base de pessoas privada**, armazenada criptografada no navegador e separada dos lançamentos.
- Status das fontes com contingência e mensagens amigáveis.

## Fontes públicas

- TSE / DivulgaCandContas e Dados Abertos — Candidatos 2026.
- TSE / Dados Abertos — Eleitorado por local de votação 2026.

O bairro apresentado no módulo territorial é o bairro do **local de votação** publicado no arquivo oficial; não é inferido como bairro de residência do eleitor.

## Privacidade

O repositório público não deve conter planilhas, CSVs, CPFs, datas de nascimento, contatos ou outros dados pessoais. A Base de pessoas usa criptografia AES-GCM no navegador e exige senha local. Não existe campo de candidatura, partido, voto ou preferência política dentro do cadastro nominal.

Para importar cadastros, use um CSV privado com as colunas:

`Nome;CPF;Nascimento;Bairro;Municipio;Zona;Secao;Lideranca;Telefone;WhatsApp;Email;Observacao`

Não envie esse CSV para o GitHub.

## Vercel

Use **Framework Preset: Other**. O `vercel.json` já contém os rewrites do frontend. As funções em `/api` são serverless.

```bash
npm install
npm run check
```
