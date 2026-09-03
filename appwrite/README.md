# appwrite/ — migração de schema

Scripts sem dependência nenhuma. Rodam com o Node 18+ que já está no servidor,
usando a API REST do Appwrite. Não precisa de `npm install` nem do SDK.

## Uso

```bash
export APPWRITE_ENDPOINT="https://appwrite.kz3solucoes.cloud/v1"
export APPWRITE_PROJECT_ID="default-6a987e930039a4a13bea"
export APPWRITE_API_KEY="cole_aqui"

node appwrite/migrate.mjs --dry-run    # plano, sem tocar no servidor
node appwrite/migrate.mjs              # cria o core (34 collections)
node appwrite/migrate.mjs --extras     # + 7 collections de segurança
node appwrite/verify.mjs               # confere servidor x schema
```

Outras flags: `--only=tasks` (uma collection), `--no-buckets` (pula o Storage).

**A API key precisa dos escopos:** `databases.write`, `collections.write`,
`attributes.write`, `indexes.write`, `documents.write`, `buckets.write`,
`files.write`, `users.read`, `teams.write`.

## Arquivos

| Arquivo | O que faz |
|---|---|
| `schema.mjs` | Definição declarativa de tudo. **É a fonte da verdade** — mexeu aqui, roda `migrate` e `gen-types` |
| `migrate.mjs` | Cria database, collections, atributos, índices e buckets. Idempotente |
| `verify.mjs` | Só leitura: aponta o que falta ou divergiu |
| `gen-types.mjs` | Regenera `src/integrations/appwrite/types.ts` |
| `gen-functions.mjs` | Regenera os esqueletos das functions e o `appwrite.json` |

## Detalhes que evitam dor de cabeça

- **Índices esperam os atributos.** O Appwrite cria atributo de forma assíncrona;
  `migrate.mjs` faz polling até `status: available` antes de criar os índices.
  Em servidor lento, a primeira execução pode levar alguns minutos.
- **Roda de novo sem medo.** Tudo que já existe volta 409 e é reportado como
  "já existe", não como erro.
- **Se um atributo falhar**, o script segue e lista tudo no resumo final. Corrija
  o `schema.mjs` e rode de novo — só o que faltava é criado.
- **Apagar atributo não é reversível** e o Appwrite não faz "alter type". Para
  mudar o tipo de um campo existente, apague o atributo no console e rode o
  script de novo.
