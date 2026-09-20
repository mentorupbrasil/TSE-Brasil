# Dados e metodologia

## Candidaturas
O endpoint `/api/candidatos?cargo=` consulta o DivulgaCandContas para 2026. O escopo é Maranhão para cargos estaduais/federais e Brasil para Presidente. A resposta é normalizada para nome de urna, nome completo, número, partido, situação, foto e campos de federação/coligação quando retornados pela fonte.

## Zonas e seções
O endpoint `/api/secoes?municipio=` consulta o pacote de eleitorado 2026 no Portal de Dados Abertos do TSE, localiza o recurso do Maranhão e agrega as linhas do CSV por município + zona + seção, somando `QT_ELEITORES_PERFIL`.

## Cache e contingência
As respostas externas são mantidas em memória por um período curto. Quando uma atualização externa falha e existe uma resposta anterior na mesma instância serverless, a API pode retornar o último dado bem-sucedido com `stale: true`.

## Datas
- `queriedAt`: quando a fonte foi consultada pelo portal.
- `sourceUpdatedAt`: data de atualização fornecida pela própria fonte, quando disponível.

## Limitações
Instâncias serverless podem ser recicladas, portanto o cache em memória não é persistente. A situação de candidaturas pode mudar conforme decisões da Justiça Eleitoral. Este projeto organiza dados públicos e não substitui a consulta à fonte oficial.
