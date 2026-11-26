# Relatório de QA — Painel de Oportunidades de Emprego v4.4.0

**Responsável pelo projeto:** Nailson Rodrigues de Lima  
**Branch:** `portfoliolimavirtual`  
**Data da validação:** 26/11/2026  
**Execução de CI:** [GitHub Actions — testes, atualização e QA](https://github.com/onsitelimavirtual/painel-de-oportunidades/actions/runs/45827135244)

## 1. Escopo da versão 4.4.0

A versão 4.4.0 amplia o painel de consulta de oportunidades com um portal editorial de orientação profissional, mantendo os módulos existentes de vagas, concursos, favoritos, fontes, indicadores e projetos autorais.

Foram incorporados:

- Recomendações para pesquisa de vagas, leitura de requisitos e organização das candidaturas.
- Orientações de currículo, apresentação de competências e proteção de dados pessoais.
- Dicas para entrevistas presenciais e on-line.
- Estrutura STAR para organizar respostas baseadas em experiências reais.
- Orientações para quem ainda não possui experiência profissional formal.
- Técnicas de estudo com prática de recuperação, revisão espaçada, resolução de questões e registro de erros.
- Recomendações específicas para preparação para concursos a partir do edital oficial.
- Plano semanal adaptável, perguntas frequentes e fontes públicas de aprofundamento.
- Navegação responsiva com acesso direto à seção Preparação.
- Atualização do título, descrição da página, versão e caminho do favicon.

O guia é informativo. Não promete contratação, não confirma a disponibilidade de vagas e não substitui editais ou instruções oficiais.

## 2. Testes automatizados

Arquivo principal: `tests/atualizacao.test.mjs`.

**Resultado: 17 testes aprovados, 0 falhas.**

A suíte cobre, entre outros pontos:

- Decodificação e filtragem de referências RSS.
- Validação de domínios, datas, concursos e prazos.
- Preservação do catálogo quando todas as fontes falham.
- Atualização parcial quando pelo menos uma fonte responde.
- Presença e configuração do contador de acessos.
- Presença da seção de orientação profissional, navegação, conteúdo de entrevistas, estudos, referências e favicon.

Execução usada pelo workflow:

```bash
node --test tests/*.test.mjs
```

## 3. QA de integridade

**Resultado: 28/28 verificações aprovadas, 0 falhas críticas e 3 alertas não críticos.**

Métricas registradas em `data/qa-status.json`:

| Indicador | Resultado |
|---|---:|
| Referências de emprego | 10 |
| Registros de concursos na curadoria | 5 |
| Concursos com inscrição dentro do período verificado | 0 |
| Concursos com prazo informado encerrado | 5 |
| Projetos autorais habilitados | 0 |
| Verificações de QA aprovadas | 28/28 |
| Falhas críticas | 0 |
| Alertas | 3 |

### Alertas que exigem revisão humana

1. **Curadoria antiga:** última conferência humana registrada em 15/10/2026; na execução de 26/11/2026, havia 42 dias sem revisão.
2. **Nenhuma inscrição vigente:** nenhum dos cinco registros possuía prazo de inscrição dentro do período informado na execução.
3. **Prazos encerrados:** os cinco registros são exibidos como encerrados, não como oportunidades abertas.

Esses alertas não impedem a publicação, mas a seção de concursos deve ser revisada manualmente antes de divulgar qualquer edital como vigente. Não se deve presumir prorrogação, reabertura ou cancelamento sem fonte oficial.

## 4. Atualização e publicação

A execução do workflow `Atualizar oportunidades e executar QA de integridade` concluiu com sucesso:

- Testes automatizados: sucesso.
- Atualização de referências de emprego: sucesso.
- Atualização do catálogo curado e descoberta de notícias: sucesso.
- Motor de QA: sucesso, com 28 verificações aprovadas e 3 alertas.
- Publicação dos catálogos aprovados: sucesso.

O build e o deploy do GitHub Pages foram concluídos com sucesso na execução [pages build and deployment](https://github.com/onsitelimavirtual/painel-de-oportunidades/actions/runs/45827386965). A publicação no GitHub Pages foi confirmada pelo resultado bem-sucedido do workflow; a disponibilidade do domínio personalizado ainda depende da propagação DNS e da configuração HTTPS.

## 5. Fontes públicas incluídas no portal

- [Superintendência de Carreiras do Centro Paula Souza — preparação para entrevistas](https://carreiras.cps.sp.gov.br/como-se-preparar-para-uma-entrevista-de-emprego-6-dicas-para-se-destacar/).
- [Ministério do Trabalho e Emprego — buscar emprego no SINE](https://www.gov.br/pt-br/servicos/buscar-emprego-no-sistema-nacional-de-emprego-sine).
- [Boletim do Instituto de Saúde — estratégias de aprendizado e prática de estudo espaçado](https://periodicos.saude.sp.gov.br/bis/article/view/39874).
- [EduCapes — Manual de Técnicas e Organização de Estudo](https://educapes.capes.gov.br/handle/capes/744814).

Os links foram conferidos durante a implementação. O conteúdo do portal foi redigido como orientação geral e não reproduz integralmente os materiais referenciados.

## 6. Limitações e próximos controles

- Não há suíte E2E de navegador nesta versão; o CI não substitui teste visual em aparelhos Android e desktop.
- Não foi executada auditoria formal WCAG nem teste com leitor de tela.
- O QA valida a consistência estrutural dos catálogos, mas não confirma em linguagem natural cada vaga, retificação ou edital.
- O RSS do Google Notícias é fonte intermediária de descoberta, não API oficial das empresas, jornais ou bancas.
- A disponibilidade de cada oportunidade deve ser conferida no anúncio original.
- A curadoria de concursos precisa de revisão humana para que o painel volte a apresentar editais com prazos vigentes.
- A aprovação do Google AdSense é um processo separado da integridade técnica e da publicação do site.

## 7. Histórico resumido

A versão 4.3.3 incorporou o contador agregado de visualizações. As versões 4.3.1 e 4.3.2 corrigiram problemas de navegação móvel, organização dos caminhos de arquivos, atualização agendada e QA. A versão 4.4.0 acrescenta o portal de orientação profissional e sua verificação automatizada.
