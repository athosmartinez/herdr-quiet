# Quiet — design do layout para o herdr

> Registro da entrevista e das decisões. O estado atual do layout está no `RECIPE.md`: a sidebar mantém o avatar e os tamanhos do herdr, põe o status à direita e mostra a contagem de subagentes.

Quiet é um layout para o herdr, com tema escuro e tema claro e mods próprios. A ideia é simples: a tela fica neutra, e só o que pede atenção tem cor.

## 1. Origens

| De onde | O que entra no Quiet |
|---|---|
| t3code | Fundo preto puro, bordas finas (branco a 8%), hover e seleção por alpha pré-misturado, acento índigo, texto de metadado em 11px |
| Orca | Uma forma diferente para cada status (spinner, check, ?); superfícies em camadas; dados de git e PR em cada workspace |
| O seu uso | Layout Main (sidebar de spaces e agentes, abas, terminais), JetBrains Mono, spaces em várias máquinas, base de PR diferente a cada task |

## 2. Paleta

Os arquivos de tema aceitam só `#rrggbb`. Por isso, cada alpha do t3code já vem misturado em hex sólido, um valor para cada tema. Arquivos: `themes/quiet-dark.json` e `themes/quiet-light.json`.

| Slot | Escuro | Claro | Uso |
|---|---|---|---|
| canvas | `#000000` | `#fcfcfc` | fundo da janela |
| chrome | `#0a0a0a` | `#fafafa` | sidebar e barra de abas |
| background | `#050505` | `#ffffff` | terminais |
| surface / popover / raised | `#111111` / `#141414` / `#171717` | `#ffffff` | painéis e menus |
| hover / selected | `#1d1d1d` / `#242424` | `#f4f4f5` / `#ececef` | linhas da sidebar |
| border / input | `#1e1e1e` / `#252525` | `#e4e4e7` / `#d4d4d8` | linhas finas |
| foreground / muted / dim | `#f5f5f5` / `#a3a3a3` / `#737373` | `#18181b` / `#71717a` / `#a1a1aa` | texto |
| accent (= solid) | `#346bf1` | `#1b4ed8` | foco, seleção, botão |
| selection | `#13244c` | `#dbe4ff` | seleção no terminal |
| cursor | `#b4cbff` | `#3f3f46` | cursor |

Contraste medido: texto sobre fundo 18,7:1 (escuro) e 17,7:1 (claro); muted sobre chrome 7,8:1 e 4,6:1; acento como anel de foco ≥ 4,3:1. O `dim` serve só para texto de apoio que não carrega informação.

ANSI: os 16 tons usam os 400/300 do Tailwind no escuro e os 600/700 no claro. Cada cor fica ≥ 4,8:1 sobre o fundo do terminal.

## 3. Status dos agentes

O herdr tem 4 status. `done` já quer dizer "terminou e você ainda não viu", e vira `idle` quando você olha. Por isso, o Quiet não precisa de um ponto azul de "não lido" separado.

| Status | Forma | Escuro | Claro | Movimento |
|---|---|---|---|---|
| working | arco (spinner) | `#6cb5d8` | `#0284c7` | `spin(900)` |
| blocked | ? dentro de um círculo | `#e9c348` | `#d97706` | `pulse` lento |
| done | check | `#64d1a6` | `#059669` | nenhum |
| idle | ponto vazado | `#525252` | `#a1a1aa` | nenhum |

O acento índigo não é cor de status, então o foco nunca se confunde com um agente. As animações rodam nativas e só quando o ícone está na tela.

## 4. Sidebar: duas linhas por space

```
◌ agents-config            ⌂ local
  theme-config · #124 ✓ → main · +82 −14
? api-server               ⎈ remoto
  feat/x · #88 draft → dev · +310 −40
```

| Campo | Fonte | Quando falta |
|---|---|---|
| ícone de status | `SpaceInfo.status` | ponto vazado |
| nome | `SpaceInfo.name` | — |
| máquina | `SpaceInfo.machine` (null = esta máquina) | "local" |
| branch | `SpaceInfo.branch` | a linha 2 some |
| PR #, estado, review, base | `gh pr view --json number,state,isDraft,reviewDecision,baseRefName` com `exec(..., {cwd: folder, on: machine})` | sem trecho de PR |
| diff +/− | com PR: `git diff --shortstat origin/<base>...HEAD`; sem PR: só as mudanças não commitadas | sem trecho de diff |

Regras:
- **Nunca adivinhar a base.** Sem PR, o Quiet não compara com `main`, porque cada task tem a sua base.
- **Falha do `gh` = linha sem PR**, nunca um estado de erro. O `gh` pode faltar, estar sem login ou usar a conta errada naquela máquina.
- **Cache** por (máquina, pasta, branch). O mod atualiza quando o branch muda, quando o space ganha o foco e a cada 2 min no máximo. Nunca a cada render.

Cores do PR: draft `dim`, aberto `muted`, aprovado `done`, mudanças pedidas `blocked`, mergeado `accent`.

## 5. Estrutura

Diferença em relação ao Main:
- `layouts/quiet.json` é uma cópia de `main.json` com `"theme": {"light": "quiet-light", "dark": "quiet-dark"}`, padding do terminal `[14, 12]`, raio dos painéis 8 e borda `border`.
- O bloco `spaces` usa `mods/quiet-spaces` (fork do `spaces` com a linha 2 e os ícones de status).
- O bloco `agents` usa o mod `agents` do herdr, sem fork. Ele já desenha um status com forma (spinner, etiqueta "Needs you", ponto, anel) e já usa as cores de status do tema. Um fork de 466 linhas só para trocar o ponto de `done` por um check custa mais manutenção do que vale.
- `font` não é definido, então a fonte do `settings.json` de cada pessoa vale.
- Os mods originais não mudam. Os mods enviados pelo herdr ficam no `installed.json`, e uma atualização pode sobrescrever esses mods.

## 6. Repo público

```
herdr-quiet/
  layouts/quiet.json
  layouts/quiet.svg          # preview na tela de settings
  themes/quiet-dark.json
  themes/quiet-light.json
  mods/quiet-spaces/
  RECIPE.md                  # What you see / How it behaves / Built from / Watch out / Done when
  preview.png
  LICENSE                    # Apache-2.0, como o herdr
```

- Topic do GitHub: `herdr-layout`. A galeria indexa o repo em até 1 hora.
- **Dados falsos em tudo o que é público** (`preview.png`, RECIPE, exemplos): nenhum IP, hostname, nome de empresa, branch ou chave de task real.
- `RECIPE.md` e o README em inglês, porque a galeria é internacional.

## 7. Fora do escopo desta versão

- Uso e custo de Claude e Codex (você não marcou essa opção).
- Painel lateral de diff.
- Integração com o Linear.
