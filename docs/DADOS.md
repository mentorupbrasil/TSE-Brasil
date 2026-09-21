# Dados e metodologia

## Candidaturas

O portal consulta candidaturas por cargo no TSE. Quando a consulta principal não está disponível, o backend pode utilizar o arquivo oficial de Candidatos 2026 publicado no CDN do TSE.

## Zonas, seções, bairros e locais

O módulo territorial usa o recurso oficial **Eleitorado por local de votação — 2026**. O arquivo é processado em fluxo no servidor e somente registros do Maranhão são mantidos para a resposta.

Campos usados quando disponíveis: município, zona, seção, bairro do local, nome do local de votação, endereço, CEP, acessibilidade e eleitorado agregado.

“Bairro” significa bairro do local de votação. O portal não deduz o bairro de residência de uma pessoa a partir desse conjunto.

## Lançamentos manuais

A área `/lancamentos` guarda registros criados manualmente no `localStorage` do navegador. Cada novo registro vale uma unidade. Esses dados não pertencem ao TSE, não são apuração oficial e não são apresentados como previsão eleitoral.

## Base de pessoas

A área `/base` é separada dos lançamentos. Ela permite nome, CPF, nascimento, bairro, município, zona, seção, liderança e dados de contato. O conteúdo é criptografado localmente com Web Crypto (PBKDF2 + AES-GCM) antes de ser salvo no navegador.

O cadastro nominal não possui campo de candidatura, partido, voto ou preferência política.
