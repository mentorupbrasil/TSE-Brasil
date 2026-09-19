# Cívica — Simulador Eleitoral

Painel cenográfico de apuração eleitoral feito em HTML, CSS e JavaScript puros.
Funciona inteiramente no navegador, sem banco de dados e sem conexão com
sistemas eleitorais.

> **Demonstração fictícia:** candidatos, partidos, votos, zonas, seções, urnas,
> lotes e registros são inventados. A identificação de simulação permanece
> visível na interface.

## O que está incluído

- Painel de apuração animada.
- Filtros para os 217 municípios do Maranhão.
- Cargos de governador, senador, deputado federal, deputado estadual e
  presidente.
- Catálogo de candidaturas e partidos fictícios.
- Inventário de urnas e seções simuladas.
- Gerador de cenários com lotes sintéticos.
- Registro de atividade, auditoria fictícia e exportação de relatório.
- Impressão, tela cheia e layout responsivo.

## Estrutura

```text
.
├── .github/workflows/pages.yml   # Publicação opcional no GitHub Pages
├── .openai/hosting.json          # Configuração da versão publicada em Sites
├── assets/
│   ├── app.js                    # Comportamento e interações
│   └── styles.css                # Estilos completos
├── data/
│   ├── election.js               # Cargos, partidos, candidatos e urnas fictícias
│   └── municipalities.js         # 217 municípios e códigos territoriais
├── docs/
│   └── DADOS.md                  # Explicação dos dados
├── index.html                    # Página principal
├── package.json                  # Comandos locais, sem dependências
└── server.mjs                    # Servidor local simples
```

## Abrir no computador

Você pode abrir `index.html` diretamente no navegador.

Para usar um servidor local:

```bash
npm start
```

Depois acesse `http://localhost:4173`.

## Subir para o GitHub

1. Crie um repositório vazio no GitHub.
2. Extraia este ZIP.
3. Envie todos os arquivos e pastas, inclusive `.github` e `.openai`.
4. Se quiser publicar, abra **Settings → Pages** e selecione
   **GitHub Actions** como fonte.

O projeto não requer Neon, Vercel, banco de dados ou instalação de pacotes.

