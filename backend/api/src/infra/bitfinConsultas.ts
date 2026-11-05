/**
 * Consultas da foto do Bitfin (SQL Server, banco UNLTD_EVERBLUE).
 *
 * SOMENTE LEITURA: o usuário do banco tem apenas db_datareader e, como segunda
 * barreira, `conferirSomenteLeitura` recusa qualquer texto com comando de
 * escrita (testado). Cada consulta foi conferida contra as telas do Bitfin
 * nas rodadas 1 a 5 (out/2026) — ver documento "bitfin-regras-fechadas".
 *
 * Escopo da foto: clientes com situação diferente de Normal E risco > 0
 * (Monitoramento, Saída de Risco, Recuperação de Crédito e Jurídico).
 * Situação desconhecida também entra — e recusa a foto (fail-closed).
 *
 * `MembroInterno.Senha` nunca é lida.
 *
 * Proteção da carga (padrão corporativo de conexões, §8): nenhuma função sobre
 * coluna usada como filtro de documento — Entidade.Documento é varchar(15)
 * com zeros (comparado com o parâmetro já normalizado) e pesCNPJCPF das
 * visões VADU é varchar(14) só com dígitos (conferido nas rodadas de 10/2026),
 * comparado direto. CAST(datetime AS date) segue sargável no SQL Server.
 */

const FOTO = `foto AS (
  SELECT c.ClienteId, c.EntidadeId, c.Situacao, c.PosicaoId
    FROM Cliente c
    JOIN ClientePosicao cp ON cp.PosicaoId = c.PosicaoId
   WHERE c.Situacao <> 'Normal' AND cp.RiscoTotalTotal > 0)`

const HOJE = 'CAST(GETDATE() AS date)'

export const CONSULTAS_FOTO = {
  clientes: `WITH ${FOTO}
SELECT c.ClienteId, e.Nome, e.Documento, c.Situacao, e.GrupoEconomicoId, g.Nome AS Grupo,
       cn.Secao AS CnaeSecao, cn.Denominacao AS CnaeDenominacao,
       cp.RiscoTotalTotal, cp.RiscoVencidoTotal, cp.IndiceDeLiquidez, cp.VencimentarioDaLiquidez,
       cp.TotalDosLiquidadosDaLiquidez, cp.TotalDosRecompradosDaLiquidez,
       cp.DataInicialDaLiquidez, cp.DataFinalDaLiquidez, cp.DataDeApuracaoDaLiquidez
  FROM foto c
  JOIN Entidade e ON e.EntidadeId = c.EntidadeId
  JOIN ClientePosicao cp ON cp.PosicaoId = c.PosicaoId
  LEFT JOIN GrupoEconomico g ON g.GrupoEconomicoId = e.GrupoEconomicoId
  LEFT JOIN Cnae cn ON cn.Chave = e.ChaveDoCnae
 ORDER BY c.ClienteId`,

  responsaveis: `WITH ${FOTO},
vigente AS (
  SELECT cr.ClienteId, cr.GerenteId, cr.AssistenteId, cr.SubgerenteId, cr.SuperintendenteId, cr.DiretorId,
         ROW_NUMBER() OVER (PARTITION BY cr.ClienteId ORDER BY cr.DataInicial DESC) AS Ordem
    FROM ClienteResponsavel cr
    JOIN foto ON foto.ClienteId = cr.ClienteId
   WHERE (cr.DataInicial IS NULL OR CAST(cr.DataInicial AS date) <= ${HOJE})
     AND (cr.DataFinal IS NULL OR CAST(cr.DataFinal AS date) >= ${HOJE}))
SELECT v.ClienteId, x.Papel, mi.MembroInternoId, en.Nome, mi.Email, mi.Ativo
  FROM vigente v
 CROSS APPLY (VALUES ('GERENTE', v.GerenteId), ('ASSISTENTE', v.AssistenteId), ('SUBGERENTE', v.SubgerenteId),
                     ('SUPERINTENDENTE', v.SuperintendenteId), ('DIRETOR', v.DiretorId)) x(Papel, MembroId)
  JOIN MembroInterno mi ON mi.MembroInternoId = x.MembroId
  LEFT JOIN Entidade en ON en.EntidadeId = mi.EntidadeId
 WHERE v.Ordem = 1`,

  contas: `WITH ${FOTO}
SELECT co.ClienteId, co.ContaOperacionalId, co.ContaCorrenteId, p.ProdutoId, p.Descricao AS Produto, ua.Alias AS Unidade,
       cop.RiscoTotalTotal, cop.RiscoVencidoTotal, cop.RiscoVencidoPrimeiraData, cop.ProrrogadosTotal,
       cop.SemAtuacaoTotal, cop.TransacaoEmAndamentoTotal, cop.TransacaoNaoConcluidaTotal, cop.LastroInconsistenteTotal,
       cop.TransacaoDesconhecidaTotal, cop.ProtestadoTotal, cop.TransacaoConcluidaTotal, cop.PromessaDePagamentoTotal,
       cop.CienciaDaTransacaoTotal, cop.SacadoNaoConfirmaTotal, cop.InacessivelTotal,
       cop.IndiceDeLiquidez, cop.VencimentarioDaLiquidez, cop.TotalDosLiquidadosDaLiquidez,
       cop.TotalDosRecompradosDaLiquidez, cop.TotalDoVencidosPenalizadosDaLiquidez
  FROM foto
  JOIN ContaOperacional co ON co.ClienteId = foto.ClienteId
  JOIN Produto p ON p.ProdutoId = co.ProdutoId
  JOIN UnidadeAdministrativa ua ON ua.UnidadeAdministrativaId = co.UnidadeAdministrativaId
  JOIN ContaOperacionalPosicao cop ON cop.PosicaoId = co.PosicaoId
 WHERE cop.RiscoTotalTotal <> 0 OR cop.TotalDosLiquidadosDaLiquidez <> 0 OR cop.TotalDosRecompradosDaLiquidez <> 0`,

  produtos: `WITH ${FOTO}
SELECT foto.ClienteId, p.ProdutoId, p.Descricao AS Produto, cpp.LimiteOperacional, cpp.Tranche, cpp.RiscoTotalTotal
  FROM foto
  JOIN ClientePosicaoProduto cpp ON cpp.PosicaoId = foto.PosicaoId
  JOIN Produto p ON p.ProdutoId = cpp.ProdutoId
 WHERE cpp.LimiteOperacional <> 0 OR cpp.RiscoTotalTotal <> 0 OR cpp.Tranche <> 0`,

  produtosGrupo: `WITH ${FOTO},
grupos AS (SELECT DISTINCT e.GrupoEconomicoId FROM foto JOIN Entidade e ON e.EntidadeId = foto.EntidadeId WHERE e.GrupoEconomicoId IS NOT NULL)
SELECT ca.GrupoEconomicoId, p.ProdutoId, p.Descricao AS Produto, cap.LimiteOperacional, cap.Tranche,
       cap.RiscoTotalTotal, cap.TransacaoConcluidaTotal
  FROM ContaOperacionalAgrupada ca
  JOIN grupos ON grupos.GrupoEconomicoId = ca.GrupoEconomicoId
  JOIN Produto p ON p.ProdutoId = ca.ProdutoId
  JOIN ContaOperacionalAgrupadaPosicao cap ON cap.PosicaoId = ca.PosicaoId
 WHERE cap.RiscoTotalTotal <> 0 OR cap.LimiteOperacional <> 0 OR cap.Tranche <> 0`,

  propostas: `WITH ${FOTO},
grupos AS (SELECT DISTINCT e.GrupoEconomicoId FROM foto JOIN Entidade e ON e.EntidadeId = foto.EntidadeId WHERE e.GrupoEconomicoId IS NOT NULL),
vigentes AS (
  SELECT pr.GrupoEconomicoId, pr.PropostaId, pr.TotalDosLimites, pr.DataDeValidade, pr.Vigente,
         ROW_NUMBER() OVER (PARTITION BY pr.GrupoEconomicoId ORDER BY pr.DataDeCadastro DESC, pr.PropostaId DESC) AS Ordem
    FROM Proposta pr
    JOIN grupos ON grupos.GrupoEconomicoId = pr.GrupoEconomicoId
   WHERE pr.Vigente = 1)
SELECT GrupoEconomicoId, PropostaId, TotalDosLimites, DataDeValidade, Vigente FROM vigentes WHERE Ordem = 1`,

  // IL = liquidado ÷ todos os títulos que venceram na janela, terminando no
  // último dia da janela de 30 dias do Bitfin (conferido em 17 de 17 contas).
  liquidez: `WITH ${FOTO},
janelas AS (SELECT n FROM (VALUES (30), (60), (90), (120), (150), (180)) v(n)),
contas AS (
  SELECT co.ClienteId, co.ContaOperacionalId,
         COALESCE(CAST(cop.DataFinalDaLiquidez AS date), CAST(cp.DataFinalDaLiquidez AS date), DATEADD(day, -1, ${HOJE})) AS Fim
    FROM foto
    JOIN ClientePosicao cp ON cp.PosicaoId = foto.PosicaoId
    JOIN ContaOperacional co ON co.ClienteId = foto.ClienteId
    JOIN Produto p ON p.ProdutoId = co.ProdutoId AND p.IndiceDeLiquidez = 1
    JOIN ContaOperacionalPosicao cop ON cop.PosicaoId = co.PosicaoId)
SELECT c.ClienteId, j.n AS Janela,
       SUM(CASE WHEN t.Situacao = 1 THEN t.Valor ELSE 0 END) AS Liquidado,
       SUM(t.Valor) AS Total
  FROM contas c
 CROSS JOIN janelas j
  JOIN Titulo t ON t.ContaOperacionalId = c.ContaOperacionalId
 WHERE CAST(t.DataDeVencimentoEfetiva AS date) > DATEADD(day, -j.n, c.Fim)
   AND CAST(t.DataDeVencimentoEfetiva AS date) <= c.Fim
 GROUP BY c.ClienteId, j.n`,

  // Prazo médio: 5 últimas operações efetivadas de Faturização, Comissária,
  // Custódia, Cobrança Vinculada e Trava Bancária (grupo 1); sem nenhuma, de
  // Nota Comercial (grupo 2). Prazo de cada operação = média dos títulos
  // ponderada pelo valor (= tela "Vencimentos da operação").
  operacoesPrazo: `WITH ${FOTO},
ops AS (
  SELECT co.ClienteId, o.OperacaoId, o.DataDeEfetivacao, p.Descricao AS Produto,
         CASE WHEN p.ProdutoId IN (1, 2, 6, 7, 17) THEN 1 ELSE 2 END AS Grupo,
         ROW_NUMBER() OVER (PARTITION BY co.ClienteId, CASE WHEN p.ProdutoId IN (1, 2, 6, 7, 17) THEN 1 ELSE 2 END
                            ORDER BY o.DataDeEfetivacao DESC, o.OperacaoId DESC) AS Ordem
    FROM foto
    JOIN ContaOperacional co ON co.ClienteId = foto.ClienteId
    JOIN Operacao o ON o.ContaOperacionalId = co.ContaOperacionalId AND o.Efetivada = 1
    JOIN Produto p ON p.ProdutoId = co.ProdutoId AND p.ProdutoId IN (1, 2, 6, 7, 17, 18))
SELECT ops.ClienteId, ops.Grupo, ops.Ordem, ops.OperacaoId, ops.DataDeEfetivacao, ops.Produto,
       SUM(oi.ValorBase) AS ValorBase,
       SUM(oi.ValorBase * oi.PrazoReal) / NULLIF(SUM(oi.ValorBase), 0) AS Prazo
  FROM ops
  JOIN OperacaoItem oi ON oi.OperacaoId = ops.OperacaoId
 WHERE ops.Ordem <= 5
 GROUP BY ops.ClienteId, ops.Grupo, ops.Ordem, ops.OperacaoId, ops.DataDeEfetivacao, ops.Produto`,

  // Atraso médio: títulos liquidados na janela de 30 dias da liquidez, média
  // dos dias de atraso ponderada pelo valor; pago em dia ou antes = 0.
  atrasos: `WITH ${FOTO},
janela AS (
  SELECT foto.ClienteId,
         COALESCE(CAST(cp.DataInicialDaLiquidez AS date), DATEADD(day, -30, ${HOJE})) AS Inicio,
         COALESCE(CAST(cp.DataFinalDaLiquidez AS date), DATEADD(day, -1, ${HOJE})) AS Fim
    FROM foto JOIN ClientePosicao cp ON cp.PosicaoId = foto.PosicaoId)
SELECT j.ClienteId, SUM(t.Valor) AS Valor,
       SUM(t.Valor * CASE WHEN CAST(t.DataDaSituacao AS date) > CAST(t.DataDeVencimentoEfetiva AS date)
                          THEN DATEDIFF(day, CAST(t.DataDeVencimentoEfetiva AS date), CAST(t.DataDaSituacao AS date)) ELSE 0 END) AS ValorVezesDias
  FROM janela j
  JOIN ContaOperacional co ON co.ClienteId = j.ClienteId
  JOIN Produto p ON p.ProdutoId = co.ProdutoId AND p.IndiceDeLiquidez = 1
  JOIN Titulo t ON t.ContaOperacionalId = co.ContaOperacionalId AND t.Situacao IN (1, 2)
 WHERE CAST(t.DataDaSituacao AS date) BETWEEN j.Inicio AND j.Fim
 GROUP BY j.ClienteId`,

  pontualidade: `WITH ${FOTO},
docs AS (SELECT DISTINCT RIGHT(e.Documento, 14) AS Doc FROM foto JOIN Entidade e ON e.EntidadeId = foto.EntidadeId)
SELECT v.pesCNPJCPF, v.ano, v.mes, v.emDia, v.esperado, v.pontual, v.de8_15, v.de16_30, v.de31_60, v.de61_, v.recomprado
  FROM VIEW_VADU_2_CedenteRisco v
 WHERE v.pesCNPJCPF IN (SELECT Doc FROM docs)
   AND (v.ano * 100 + v.mes) >= (YEAR(DATEADD(month, -2, ${HOJE})) * 100 + MONTH(DATEADD(month, -2, ${HOJE})))`,

  aging: `WITH ${FOTO},
docs AS (SELECT DISTINCT RIGHT(e.Documento, 14) AS Doc FROM foto JOIN Entidade e ON e.EntidadeId = foto.EntidadeId)
SELECT v.pesCNPJCPF, v.vencerDe5V_30, v.vencerDe31_60, v.vencerDe61_90, v.vencerDe91_180, v.vencerDe181_360, v.vencerDe361_,
       v.vencidoDe6_30, v.vencidoDe31_60, v.vencidoDe61_90, v.vencidoDe91_180, v.vencidoDe181_360, v.vencidoDe361_
  FROM VIEW_VADU_2_CedenteResumo v
 WHERE v.pesCNPJCPF IN (SELECT Doc FROM docs)`,

  // Eventos da última semana (regra do especialista), com as ocorrências.
  eventos: `WITH ${FOTO},
inicio AS (SELECT DATEADD(day, -6, ${HOJE}) AS d)
SELECT ec.ClienteId, ev.EventoId, ev.Titulo, ev.Categoria, ev.Nivel, ev.Desfecho, ev.DataDeCadastro, ev.DataDeAtualizacao,
       ent.Nome AS CriadoPor, oc.Data AS DataOcorrencia, oc.Autor, oc.Categoria AS CategoriaOcorrencia, oc.Mensagem
  FROM inicio CROSS JOIN Evento ev
  JOIN EventoCliente ec ON ec.EventoId = ev.EventoId
  JOIN foto ON foto.ClienteId = ec.ClienteId
  LEFT JOIN MembroInterno mi ON mi.MembroInternoId = ev.MembroInternoId
  LEFT JOIN Entidade ent ON ent.EntidadeId = mi.EntidadeId
  LEFT JOIN EventoOcorrencia oc ON oc.EventoId = ev.EventoId
 WHERE ev.DataDeCadastro >= inicio.d OR ev.DataDeAtualizacao >= inicio.d OR oc.Data >= inicio.d
 ORDER BY ec.ClienteId, ev.DataDeCadastro DESC, oc.Data`,

  operacoesMes: `WITH ${FOTO},
meses AS (SELECT DATEFROMPARTS(YEAR(${HOJE}), MONTH(${HOJE}), 1) AS Atual,
                 DATEADD(month, -1, DATEFROMPARTS(YEAR(${HOJE}), MONTH(${HOJE}), 1)) AS Anterior)
SELECT co.ClienteId,
       SUM(CASE WHEN CAST(o.DataDeEfetivacao AS date) >= m.Anterior AND CAST(o.DataDeEfetivacao AS date) < m.Atual THEN oi.ValorBase ELSE 0 END) AS MesAnterior,
       SUM(CASE WHEN CAST(o.DataDeEfetivacao AS date) >= m.Atual THEN oi.ValorBase ELSE 0 END) AS MesAtual
  FROM meses m CROSS JOIN foto
  JOIN ContaOperacional co ON co.ClienteId = foto.ClienteId
  JOIN Operacao o ON o.ContaOperacionalId = co.ContaOperacionalId AND o.Efetivada = 1 AND CAST(o.DataDeEfetivacao AS date) >= m.Anterior
  JOIN OperacaoItem oi ON oi.OperacaoId = o.OperacaoId
 GROUP BY co.ClienteId`,
} as const

export type NomeConsultaFoto = keyof typeof CONSULTAS_FOTO

const PROIBIDO =
  /\b(insert|update|delete|merge|drop|alter|create|truncate|exec|execute|grant|revoke|deny|backup|restore|dbcc|shutdown|kill|bulk|openrowset|opendatasource|openquery|into|reconfigure)\b|\b(xp|sp)_|\bSenha\b/i

/** Segunda barreira (a primeira é o usuário só com db_datareader): nenhuma
 * consulta da foto pode conter comando de escrita nem ler senha. */
export function conferirSomenteLeitura(sql: string): void {
  const semComentario = sql.replace(/--.*$/gm, '')
  const achado = PROIBIDO.exec(semComentario)
  if (achado) throw new Error(`Consulta recusada: contém "${achado[0]}". A foto do Bitfin é somente leitura.`)
}

for (const sql of Object.values(CONSULTAS_FOTO)) conferirSomenteLeitura(sql)

// ---------------------------------------------------------------------------
// Mapa de Garantias: clientes escolhidos pelo especialista (por CNPJ), que
// podem estar em qualquer situação no Bitfin. Os documentos entram como
// PARÂMETROS (@d0, @d1, …), nunca concatenados no texto.
// ---------------------------------------------------------------------------

/** Documento como o Bitfin grava (15 dígitos, zero à esquerda). */
export function documentoBitfin(digitos: string): string {
  return digitos.replace(/\D/g, '').padStart(15, '0')
}

/**
 * Normalização no PARÂMETRO, nunca na coluna (padrão corporativo, §8): a
 * coluna Entidade.Documento é varchar(15) com zeros à esquerda (conferido nas
 * rodadas de 10/2026: 25 de 25 amostras com 15 dígitos). Para não aplicar
 * RIGHT() sobre a coluna — o que descarta o índice — cada documento vai em
 * duas formas: 15 dígitos (como gravado) e só os dígitos (cadastro legado
 * eventual sem zeros). Ordem dos valores = ordem dos @d no SQL.
 */
export function parametrosDocumentos(documentos: string[]): string[] {
  const digitos = documentos.map((d) => d.replace(/\D/g, ''))
  return [...digitos.map((d) => d.padStart(15, '0')), ...digitos]
}

function listaDocumentos(quantidade: number): string {
  return Array.from({ length: quantidade * 2 }, (_, i) => `@d${i}`).join(', ')
}

/** Nome (razão social) pelo CPF/CNPJ — usado ao incluir cliente no Mapa. */
export function consultaNomesClientes(quantidadeDocumentos: number): string {
  if (quantidadeDocumentos < 1 || quantidadeDocumentos > 500) throw new Error('Quantidade de documentos fora do limite (1 a 500).')
  return `SELECT DISTINCT e.Documento, e.Nome
  FROM Cliente c
  JOIN Entidade e ON e.EntidadeId = c.EntidadeId
 WHERE e.Documento IN (${listaDocumentos(quantidadeDocumentos)})`
}

export function consultasMapa(quantidadeDocumentos: number): Record<'clientes' | 'contas' | 'titulos' | 'garantias' | 'contasGraficas' | 'responsaveis', string> {
  if (quantidadeDocumentos < 1 || quantidadeDocumentos > 500) throw new Error('Quantidade de documentos do mapa fora do limite (1 a 500).')
  const MAPA = `mapa AS (
  SELECT c.ClienteId, c.EntidadeId
    FROM Cliente c
    JOIN Entidade e ON e.EntidadeId = c.EntidadeId
   WHERE e.Documento IN (${listaDocumentos(quantidadeDocumentos)}))`
  const consultas = {
    clientes: `WITH ${MAPA}
SELECT mapa.ClienteId, e.Nome, e.Documento, g.Nome AS Grupo
  FROM mapa JOIN Entidade e ON e.EntidadeId = mapa.EntidadeId
  LEFT JOIN GrupoEconomico g ON g.GrupoEconomicoId = e.GrupoEconomicoId`,
    contas: `WITH ${MAPA}
SELECT co.ClienteId, co.ContaOperacionalId, co.ContaCorrenteId, p.ProdutoId, p.Descricao AS Produto, ua.Alias AS Unidade,
       cop.RiscoTotalTotal, cop.ProrrogadosTotal, cop.IndiceDeLiquidez
  FROM mapa
  JOIN ContaOperacional co ON co.ClienteId = mapa.ClienteId
  JOIN Produto p ON p.ProdutoId = co.ProdutoId
  JOIN UnidadeAdministrativa ua ON ua.UnidadeAdministrativaId = co.UnidadeAdministrativaId
  JOIN ContaOperacionalPosicao cop ON cop.PosicaoId = co.PosicaoId`,
    // Títulos em aberto (situação 0) da Cobrança Vinculada: base do efeito vagão e das deduções.
    titulos: `WITH ${MAPA}
SELECT co.ClienteId, t.ContaOperacionalId, t.SacadoId, t.SaldoDevedor, t.DataDeVencimentoEfetiva, t.DataDeVencimento, t.Status,
       (SELECT MIN(oi.DataDeVencimentoOriginal) FROM OperacaoItem oi WHERE oi.TituloId = t.TituloId) AS DataDeVencimentoOriginal
  FROM mapa
  JOIN ContaOperacional co ON co.ClienteId = mapa.ClienteId AND co.ProdutoId = 7
  JOIN Titulo t ON t.ContaOperacionalId = co.ContaOperacionalId AND t.Situacao = 0`,
    garantias: `WITH ${MAPA}
SELECT mapa.ClienteId, g.GarantiaId, g.Tipo, g.Valor, g.Percentual, g.Status, g.ContaOperacionalId, g.DataDeVencimento,
       gb.Tipo AS BemTipo, gb.Descricao AS BemDescricao, gb.ValorEmGarantia
  FROM mapa
  JOIN Garantia g ON g.Status = 2 AND (g.EntidadeId = mapa.EntidadeId
                    OR g.ContaOperacionalId IN (SELECT ContaOperacionalId FROM ContaOperacional WHERE ClienteId = mapa.ClienteId))
  LEFT JOIN GarantiaBem gb ON gb.GarantiaId = g.GarantiaId`,
    contasGraficas: `WITH ${MAPA}
SELECT mapa.ClienteId, cc.ContaCorrenteId, cc.Descricao, p.Descricao AS Produto, cc.Saldo, cc.DataDoUltimoLancamento
  FROM mapa
  JOIN ContaOperacional co ON co.ClienteId = mapa.ClienteId
  JOIN Produto p ON p.ProdutoId = co.ProdutoId
  JOIN ContaCorrente cc ON cc.ContaCorrenteId = co.ContaCorrenteId
UNION ALL
SELECT mapa.ClienteId, cc.ContaCorrenteId, cc.Descricao, 'Conta de apoio', cc.Saldo, cc.DataDoUltimoLancamento
  FROM mapa
  JOIN ContaDeApoio ca ON ca.ClienteId = mapa.ClienteId AND ca.Ativa = 1
  JOIN ContaCorrente cc ON cc.ContaCorrenteId = ca.ContaCorrenteId`,
    responsaveis: `WITH ${MAPA},
vigente AS (
  SELECT cr.ClienteId, cr.GerenteId, cr.AssistenteId, cr.SubgerenteId, cr.SuperintendenteId, cr.DiretorId,
         ROW_NUMBER() OVER (PARTITION BY cr.ClienteId ORDER BY cr.DataInicial DESC) AS Ordem
    FROM ClienteResponsavel cr
    JOIN mapa ON mapa.ClienteId = cr.ClienteId
   WHERE (cr.DataInicial IS NULL OR CAST(cr.DataInicial AS date) <= ${HOJE})
     AND (cr.DataFinal IS NULL OR CAST(cr.DataFinal AS date) >= ${HOJE}))
SELECT v.ClienteId, x.Papel, mi.MembroInternoId, en.Nome, mi.Email, mi.Ativo
  FROM vigente v
 CROSS APPLY (VALUES ('GERENTE', v.GerenteId), ('ASSISTENTE', v.AssistenteId), ('SUBGERENTE', v.SubgerenteId),
                     ('SUPERINTENDENTE', v.SuperintendenteId), ('DIRETOR', v.DiretorId)) x(Papel, MembroId)
  JOIN MembroInterno mi ON mi.MembroInternoId = x.MembroId
  LEFT JOIN Entidade en ON en.EntidadeId = mi.EntidadeId
 WHERE v.Ordem = 1`,
  }
  for (const sql of Object.values(consultas)) conferirSomenteLeitura(sql)
  return consultas
}
