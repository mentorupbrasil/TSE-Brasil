# Dados e fontes

O sistema usa fontes públicas oficiais, sem candidaturas ou seções inventadas.

## Candidaturas
Fonte principal: DivulgaCandContas / TSE, Eleições Gerais 2026. O backend consulta a API pública e mantém cache curto para reduzir requisições repetidas.

## Zonas e seções
Fonte: Portal de Dados Abertos do TSE, conjunto Eleitorado 2026, recurso “MA - Perfil do eleitorado por seção eleitoral - 2026”. O backend localiza o recurso no catálogo CKAN, lê o CSV compactado e consolida linhas de perfil em uma linha por município/zona/seção.

## Nota
Situações de candidatura e arquivos do cadastro eleitoral podem ser atualizados pelo TSE. O painel exibe a informação retornada pela fonte no momento da consulta.
