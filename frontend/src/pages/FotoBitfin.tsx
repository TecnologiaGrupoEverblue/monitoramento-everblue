/**
 * Foto do Bitfin (1.2): tirar a foto manualmente, acompanhar a execução,
 * configurar o agendador e consultar o histórico com a comparação contra a
 * foto anterior. A importação por planilha foi desativada: tudo vem do Bitfin.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { esquemaAgendamentoFoto, esquemaTirarFoto } from "@monitoramento/dominio";
import { Link } from "react-router-dom";
import {
  Camera,
  CheckCircle2,
  Clock,
  PlugZap,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Painel } from "../components/ui/Card";
import { StatusBadge } from "../components/ui/Badges";
import { TabelaResponsiva } from "../components/ui/TabelaResponsiva";
import { useSessao } from "../contexts/SessaoContext";
import { Carregando, ErroCarga } from "../components/ui/EstadoCarga";
import { consultas, invalidar } from "../consultas";
import { ErroApi } from "../api/cliente";
import { fotoBitfinRepository } from "../repositories";
import type { AgendamentoFoto, ExecucaoFoto } from "../models/types";

type FormTirar = z.input<typeof esquemaTirarFoto>;
type FormAgendamento = z.input<typeof esquemaAgendamentoFoto>;
import {
  formatarMoeda,
  formatarPercentualOpcional,
  formatarDias,
} from "../utils/formatters";

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DIAS_LONGOS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

const ROTULO_STATUS: Record<
  ExecucaoFoto["status"],
  { texto: string; cor: string; fundo: string }
> = {
  EXECUTANDO: {
    texto: "Em andamento",
    cor: "var(--cor-destaque)",
    fundo: "var(--cor-fundo-recuado)",
  },
  CONCLUIDA: {
    texto: "Concluída",
    cor: "var(--cor-normal)",
    fundo: "var(--cor-normal-fundo)",
  },
  RECUSADA: {
    texto: "Recusada",
    cor: "var(--cor-atencao)",
    fundo: "var(--cor-atencao-fundo)",
  },
  FALHOU: {
    texto: "Falhou",
    cor: "var(--cor-critico)",
    fundo: "var(--cor-critico-fundo)",
  },
};
const ROTULO_POSICAO: Record<string, string> = {
  GRAVADA: "Posição do comitê gravada",
  JA_EXISTIA: "Posição mantida (não substituída)",
  NAO_SOLICITADA: "Só histórico",
  NAO_GRAVADA: "Posição não gravada",
};

const dataHora = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo",
      })
    : "—";
/** O Bitfin grava data/hora local sem fuso; o driver entrega como se fosse UTC.
 * Exibir em UTC mostra exatamente a hora que o Bitfin mostra. */
const dataHoraBitfin = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "UTC",
      })
    : "—";
const dataCurta = (iso: string | null) =>
  iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—";
const duracao = (e: ExecucaoFoto) => {
  if (!e.concluidoEm) return "—";
  const s = Math.max(
    0,
    Math.round(
      (new Date(e.concluidoEm).getTime() - new Date(e.iniciadoEm).getTime()) /
        1000,
    ),
  );
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
};

function EtiquetaStatus({ status }: { status: ExecucaoFoto["status"] }) {
  const r = ROTULO_STATUS[status];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap"
      style={{ color: r.cor, backgroundColor: r.fundo }}
    >
      {r.texto}
    </span>
  );
}

function Aviso({
  tipo,
  children,
}: {
  tipo: "atencao" | "critico" | "normal";
  children: React.ReactNode;
}) {
  return (
    <div
      className="border-l-2 p-2.5 text-sm"
      style={{
        borderColor: `var(--cor-${tipo})`,
        backgroundColor: `var(--cor-${tipo}-fundo)`,
        color: "var(--cor-texto-primario)",
      }}
    >
      {children}
    </div>
  );
}

export default function FotoBitfin() {
  const { pode } = useSessao();
  const clienteConsultas = useQueryClient();
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [teste, setTeste] = useState<string | null>(null);

  // Enquanto houver foto em andamento, acompanha a cada 3 s (só o Postgres;
  // o Bitfin é lido uma vez pelo servidor).
  const situacaoQ = useQuery({
    ...consultas.situacaoFoto(),
    refetchInterval: (q) => (q.state.data?.emAndamento ? 3000 : false),
  });
  const situacao = situacaoQ.data;
  const emAndamento = situacao?.emAndamento ?? null;
  const execucoesQ = useQuery({
    ...consultas.execucoesFoto(),
    refetchInterval: emAndamento ? 3000 : false,
  });
  const execucoes = execucoesQ.data ?? [];
  const selecionada = escolhida ?? situacao?.ultima?.id ?? null;

  // A foto em andamento terminou: mostra o resultado e marca os dados das
  // demais telas como desatualizados (a posição pode ter sido gravada).
  const idAndamento = emAndamento?.id ?? null;
  const andamentoAnterior = useRef<string | null>(null);
  useEffect(() => {
    if (andamentoAnterior.current && !idAndamento) {
      setEscolhida(andamentoAnterior.current);
      void invalidar(clienteConsultas, "foto", "carteira", "config");
    }
    andamentoAnterior.current = idAndamento;
  }, [idAndamento, clienteConsultas]);

  const formTirar = useForm<FormTirar>({
    resolver: zodResolver(esquemaTirarFoto),
    defaultValues: { gravarPosicao: false },
  });
  const tirarFoto = useMutation({
    mutationFn: (dados: FormTirar) =>
      fotoBitfinRepository.tirar(dados.gravarPosicao),
    onSuccess: ({ id }) => {
      setEscolhida(id);
      void invalidar(clienteConsultas, "foto");
    },
  });
  const tirar = formTirar.handleSubmit((dados) => tirarFoto.mutate(dados));
  const erro = tirarFoto.error
    ? tirarFoto.error instanceof ErroApi
      ? tirarFoto.error.message
      : "Não foi possível solicitar a foto."
    : null;
  const enviando = tirarFoto.isPending;

  const testar = useMutation({
    mutationFn: fotoBitfinRepository.testarConexao,
    onMutate: () => setTeste("Testando…"),
    onSuccess: (r) =>
      setTeste(
        `Conectado ao banco ${r.banco}. Hora do servidor do Bitfin: ${dataHoraBitfin(r.servidorAgora)}.`,
      ),
    onError: (e) =>
      setTeste(
        e instanceof ErroApi
          ? `Falha: ${e.message}`
          : "Falha ao testar a conexão.",
      ),
  });

  if (situacaoQ.isError) {
    return (
      <ErroCarga
        erro={situacaoQ.error}
        aoTentarDeNovo={() => void situacaoQ.refetch()}
      />
    );
  }
  if (!situacao) return <Carregando />;

  const ultimaConcluida = situacao.ultimaConcluida;
  const podeTirar = pode("analista") && situacao.configurado && !emAndamento;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1
          className="fonte-editorial text-2xl font-semibold"
          style={{ color: "var(--cor-primaria)" }}
        >
          Foto do Bitfin
        </h1>
        <p className="text-sm" style={{ color: "var(--cor-texto-secundario)" }}>
          Os dados dos clientes em Monitoramento, Saída de Risco, Recuperação de
          Crédito e Jurídico vêm direto do Bitfin, numa leitura única (somente
          leitura) gravada aqui e comparada com a foto anterior. As telas usam
          sempre a última foto, nunca o Bitfin ao vivo. A importação por
          planilha foi desativada.
        </p>
      </div>

      {!situacao.configurado && (
        <Aviso tipo="critico">
          A conexão com o Bitfin ainda não está configurada no servidor
          (BITFIN_SERVIDOR, BITFIN_USUARIO e BITFIN_SENHA no .env). Até lá,
          nenhuma foto pode ser tirada.
        </Aviso>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Painel titulo="Tirar foto agora">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Fato
                titulo="Última foto concluída"
                valor={
                  ultimaConcluida
                    ? dataHora(ultimaConcluida.iniciadoEm)
                    : "Nenhuma ainda"
                }
              />
              <Fato
                titulo="Apuração do Bitfin"
                valor={
                  ultimaConcluida?.bitfinApuradoEm
                    ? dataHoraBitfin(ultimaConcluida.bitfinApuradoEm)
                    : "—"
                }
              />
              <Fato
                titulo="Clientes na foto"
                valor={
                  ultimaConcluida?.clientes != null
                    ? String(ultimaConcluida.clientes)
                    : "—"
                }
              />
              <Fato
                titulo="Próximo comitê"
                valor={dataCurta(situacao.proximoComite)}
              />
            </div>
            <label
              className="flex items-start gap-2 text-sm"
              style={{ color: "var(--cor-texto-primario)" }}
            >
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                {...formTirar.register("gravarPosicao")}
                disabled={!podeTirar}
              />
              <span>
                Gravar também como posição do comitê de{" "}
                <strong>
                  {dataCurta(situacao.proximoComite) === "—"
                    ? "hoje"
                    : dataCurta(situacao.proximoComite)}
                </strong>
                <span
                  className="block text-xs"
                  style={{ color: "var(--cor-texto-secundario)" }}
                >
                  Gera a posição semanal, a classificação e os alertas. Se a
                  semana já tiver posição, esta foto a substitui (a anterior
                  fica no histórico) — até a ata do comitê ser gerada.
                </span>
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="botao-primario inline-flex items-center gap-2"
                onClick={() => void tirar()}
                disabled={!podeTirar || enviando}
              >
                <Camera size={16} aria-hidden />
                {emAndamento
                  ? "Foto em andamento…"
                  : enviando
                    ? "Solicitando…"
                    : "Tirar foto do Bitfin"}
              </button>
              {pode("admin") && (
                <button
                  className="botao-secundario inline-flex items-center gap-2"
                  onClick={() => testar.mutate()}
                  disabled={!situacao.configurado || testar.isPending}
                >
                  <PlugZap size={16} aria-hidden /> Testar conexão
                </button>
              )}
              {situacao.planilhaHabilitada && (
                <Link
                  to="/importacao"
                  className="text-xs underline"
                  style={{ color: "var(--cor-destaque)" }}
                >
                  Importação por planilha (contingência)
                </Link>
              )}
            </div>
            {!pode("analista") && (
              <p
                className="text-xs"
                style={{ color: "var(--cor-texto-secundario)" }}
              >
                Seu perfil permite apenas consulta.
              </p>
            )}
            {teste && (
              <p
                className="text-xs"
                style={{ color: "var(--cor-texto-secundario)" }}
              >
                {teste}
              </p>
            )}
            {erro && <Aviso tipo="critico">{erro}</Aviso>}
            {emAndamento && (
              <Aviso tipo="normal">
                <span className="inline-flex items-center gap-2">
                  <RefreshCw size={14} className="animate-spin" aria-hidden />{" "}
                  Lendo o Bitfin desde {dataHora(emAndamento.iniciadoEm)} (
                  {emAndamento.origem === "AGENDADA"
                    ? "agendada"
                    : `pedida por ${emAndamento.solicitadoPorNome ?? "—"}`}
                  ). Esta página atualiza sozinha.
                </span>
              </Aviso>
            )}
          </div>
        </Painel>

        <PainelAgendador
          agendamento={situacao.agendamento}
          podeEditar={pode("admin")}
        />
      </div>

      <Painel titulo={`Histórico de execuções (${execucoes.length})`}>
        <p
          className="mb-2 text-xs"
          style={{ color: "var(--cor-texto-secundario)" }}
        >
          Guarda permanente: a foto que gravou a posição do comitê e a que
          gerou Mapa de Garantias enviado alimentam as telas e os gráficos e
          nunca são apagadas. As demais (fotos de teste ou só histórico) são
          apagadas automaticamente depois de {situacao.retencaoTesteDias} dias.
        </p>
        {execucoesQ.isError ? (
          <ErroCarga
            erro={execucoesQ.error}
            aoTentarDeNovo={() => void execucoesQ.refetch()}
          />
        ) : execucoes.length === 0 ? (
          <p
            className="py-6 text-center text-sm"
            style={{ color: "var(--cor-texto-secundario)" }}
          >
            Nenhuma foto tirada ainda.
          </p>
        ) : (
          <TabelaResponsiva<ExecucaoFoto>
            rotulo="Histórico de execuções"
            linhas={execucoes}
            chave={(e) => e.id}
            aoClicar={(e) => setEscolhida(e.id)}
            estiloLinha={(e) => (selecionada === e.id ? { backgroundColor: "var(--cor-fundo-recuado)", boxShadow: "inset 3px 0 0 var(--cor-destaque)" } : undefined)}
            colunas={[
              { chave: "inicio", titulo: "Início", principal: true, classe: "numeros-tabulares whitespace-nowrap", render: (e) => dataHora(e.iniciadoEm) },
              { chave: "situacao", titulo: "Situação", render: (e) => <EtiquetaStatus status={e.status} /> },
              { chave: "origem", titulo: "Origem", render: (e) => (e.origem === "AGENDADA" ? "Agendada" : (e.solicitadoPorNome ?? "Manual")) },
              { chave: "clientes", titulo: "Clientes", alinhar: "right", classe: "numeros-tabulares", render: (e) => e.clientes ?? "—" },
              {
                chave: "posicao",
                titulo: "Posição do comitê",
                classe: "text-xs",
                render: (e) => (e.posicaoSemanal ? `${ROTULO_POSICAO[e.posicaoSemanal]}${e.semanaRef ? ` (${dataCurta(e.semanaRef)})` : ""}` : "—"),
              },
              {
                chave: "divergencias",
                titulo: "Divergências",
                alinhar: "right",
                ocultar: "lg",
                classe: "numeros-tabulares",
                render: (e) => <span style={{ color: e.divergencias.length > 0 ? "var(--cor-atencao)" : undefined }}>{e.divergencias.length || "—"}</span>,
              },
              { chave: "duracao", titulo: "Duração", alinhar: "right", ocultar: "xl", classe: "numeros-tabulares whitespace-nowrap", render: (e) => duracao(e) },
            ]}
          />
        )}
      </Painel>

      {selecionada && (
        <DetalheExecucao id={selecionada} />
      )}
    </div>
  );
}

function Fato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div
      className="rounded-lg border px-3 py-2"
      style={{ borderColor: "var(--cor-borda)" }}
    >
      <p
        className="text-[11px]"
        style={{ color: "var(--cor-texto-secundario)" }}
      >
        {titulo}
      </p>
      <p
        className="numeros-tabulares text-sm font-semibold"
        style={{ color: "var(--cor-primaria)" }}
      >
        {valor}
      </p>
    </div>
  );
}

function PainelAgendador({
  agendamento,
  podeEditar,
}: {
  agendamento: AgendamentoFoto;
  podeEditar: boolean;
}) {
  const clienteConsultas = useQueryClient();
  const valoresGravados = useMemo<FormAgendamento>(
    () => ({
      ativo: agendamento.ativo,
      horario: agendamento.horario,
      diasSemana: agendamento.diasSemana,
      diaPosicaoSemanal: agendamento.diaPosicaoSemanal,
    }),
    [agendamento],
  );
  // `values`: quando o agendamento gravado muda, o formulário acompanha.
  const { register, handleSubmit, control, setValue, formState } =
    useForm<FormAgendamento>({
      resolver: zodResolver(esquemaAgendamentoFoto),
      values: valoresGravados,
    });
  const [dias, diaPosicao] = useWatch({
    control,
    name: ["diasSemana", "diaPosicaoSemanal"],
  });
  const gravar = useMutation({
    mutationFn: (dados: FormAgendamento) =>
      fotoBitfinRepository.salvarAgendamento({
        ...dados,
        diasSemana: [...dados.diasSemana].sort(),
      }),
    onSuccess: () => void invalidar(clienteConsultas, "foto"),
  });
  const salvar = handleSubmit((dados) => gravar.mutate(dados));
  const mensagem = gravar.isError
    ? {
        tipo: "critico" as const,
        texto:
          gravar.error instanceof ErroApi
            ? gravar.error.message
            : "Não foi possível salvar.",
      }
    : gravar.isSuccess && !formState.isDirty
      ? { tipo: "normal" as const, texto: "Agendamento salvo." }
      : null;
  const erroCampo =
    formState.errors.diasSemana?.message ??
    formState.errors.horario?.message ??
    formState.errors.diaPosicaoSemanal?.message;

  function alternarDia(d: number) {
    const novo = dias.includes(d)
      ? dias.filter((x) => x !== d)
      : [...dias, d].sort();
    setValue("diasSemana", novo, { shouldDirty: true });
    if (diaPosicao !== null && !novo.includes(diaPosicao))
      setValue("diaPosicaoSemanal", null, { shouldDirty: true });
  }

  return (
    <Painel titulo="Execução automática (agendador)">
      <div className="flex flex-col gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4"
            {...register("ativo")}
            disabled={!podeEditar}
          />
          <span
            className="font-medium"
            style={{ color: "var(--cor-texto-primario)" }}
          >
            Tirar a foto automaticamente
          </span>
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span
              className="text-xs font-medium"
              style={{ color: "var(--cor-texto-secundario)" }}
            >
              Horário (Brasília)
            </span>
            <input
              type="time"
              className="campo"
              {...register("horario")}
              aria-invalid={Boolean(formState.errors.horario)}
              disabled={!podeEditar}
            />
          </label>
          <fieldset className="flex flex-col gap-1">
            <legend
              className="text-xs font-medium"
              style={{ color: "var(--cor-texto-secundario)" }}
            >
              Dias
            </legend>
            <div className="flex flex-wrap gap-1">
              {DIAS.map((rotulo, d) => (
                <button
                  key={d}
                  type="button"
                  className={`${dias.includes(d) ? "botao-primario" : "botao-secundario"} min-h-[40px] min-w-[44px] px-2 text-xs`}
                  aria-pressed={dias.includes(d)}
                  onClick={() => alternarDia(d)}
                  disabled={
                    !podeEditar || (dias.length === 1 && dias.includes(d))
                  }
                >
                  {rotulo}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        <label className="flex flex-col gap-1">
          <span
            className="text-xs font-medium"
            style={{ color: "var(--cor-texto-secundario)" }}
          >
            Gravar a posição do comitê automaticamente
          </span>
          <select
            className="campo"
            {...register("diaPosicaoSemanal", {
              setValueAs: (v: unknown) =>
                v === "" || v === null || v === undefined ? null : Number(v),
            })}
            disabled={!podeEditar}
          >
            <option value="">Nunca (só pelo botão)</option>
            {dias.map((d) => (
              <option key={d} value={d}>
                Na foto de {DIAS_LONGOS[d]}
              </option>
            ))}
          </select>
        </label>
        {erroCampo && (
          <p className="text-xs" role="alert" style={{ color: "var(--cor-critico)" }}>
            {erroCampo}
          </p>
        )}
        <p className="text-xs" style={{ color: "var(--cor-texto-secundario)" }}>
          <Clock size={12} className="mr-1 inline" aria-hidden />
          Última execução automática:{" "}
          {agendamento.ultimaExecucaoEm
            ? dataHora(agendamento.ultimaExecucaoEm)
            : "nenhuma"}
          . Se o servidor estiver parado no horário, a foto do dia roda assim
          que ele voltar. O Bitfin recalcula a liquidez às 07:00.
        </p>
        {podeEditar ? (
          <div className="flex items-center gap-3">
            <button
              className="botao-primario"
              onClick={() => void salvar()}
              disabled={!formState.isDirty || gravar.isPending}
            >
              {gravar.isPending ? "Salvando…" : "Salvar agendamento"}
            </button>
            {agendamento.atualizadoPorNome && (
              <span
                className="text-xs"
                style={{ color: "var(--cor-texto-secundario)" }}
              >
                Alterado por {agendamento.atualizadoPorNome} em{" "}
                {dataHora(agendamento.atualizadoEm)}
              </span>
            )}
          </div>
        ) : (
          <p
            className="text-xs"
            style={{ color: "var(--cor-texto-secundario)" }}
          >
            Só o administrador altera o agendamento.
          </p>
        )}
        {mensagem && <Aviso tipo={mensagem.tipo}>{mensagem.texto}</Aviso>}
      </div>
    </Painel>
  );
}

function variacao(atual: number, anterior: number | null) {
  if (anterior === null) return null;
  const d = atual - anterior;
  if (Math.abs(d) < 0.005) return null;
  return (
    <span
      className="block text-[11px]"
      style={{ color: d > 0 ? "var(--cor-critico)" : "var(--cor-normal)" }}
    >
      {d > 0 ? "+" : "−"} {formatarMoeda(Math.abs(d))}
    </span>
  );
}

function DetalheExecucao({ id }: { id: string }) {
  const q = useQuery(consultas.comparacaoFoto(id));
  const dados = q.data;
  const [filtro, setFiltro] = useState("");

  if (q.isError)
    return (
      <Painel titulo="Detalhe da foto">
        <ErroCarga erro={q.error} aoTentarDeNovo={() => void q.refetch()} />
      </Painel>
    );
  if (!dados) return <Carregando />;
  const { foto, anterior, clientes } = dados;
  const termo = filtro.trim().toLowerCase();
  const visiveis = termo
    ? clientes.filter(
        (c) =>
          c.nome.toLowerCase().includes(termo) || c.documento.includes(termo),
      )
    : clientes;

  return (
    <Painel
      titulo={`Foto de ${dataHora(foto.iniciadoEm)}${anterior ? ` × anterior de ${dataHora(anterior.iniciadoEm)}` : ""}`}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <EtiquetaStatus status={foto.status} />
          {foto.status === "CONCLUIDA" ? (
            <CheckCircle2
              size={16}
              style={{ color: "var(--cor-normal)" }}
              aria-hidden
            />
          ) : (
            foto.status !== "EXECUTANDO" && (
              <XCircle
                size={16}
                style={{ color: "var(--cor-critico)" }}
                aria-hidden
              />
            )
          )}
          <span style={{ color: "var(--cor-texto-secundario)" }}>
            {foto.origem === "AGENDADA"
              ? "Agendada"
              : `Pedida por ${foto.solicitadoPorNome ?? "—"}`}{" "}
            · regras {foto.versaoRegras}
            {foto.totais
              ? ` · risco ${formatarMoeda(foto.totais.risco)} · vencido ${formatarMoeda(foto.totais.vencido)} · ${foto.totais.eventos} evento(s) na semana`
              : ""}
          </span>
        </div>
        {foto.mensagem && (
          <Aviso
            tipo={
              foto.status === "CONCLUIDA"
                ? "normal"
                : foto.status === "RECUSADA"
                  ? "atencao"
                  : "critico"
            }
          >
            {foto.mensagem}
          </Aviso>
        )}
        {foto.recusas.length > 0 && (
          <Aviso tipo="atencao">
            <p className="font-semibold">
              Motivos da recusa (nada foi gravado na posição):
            </p>
            <ul className="list-inside list-disc text-xs">
              {foto.recusas.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </Aviso>
        )}
        {foto.divergencias.length > 0 && (
          <details
            className="rounded-lg border p-2 text-sm"
            style={{ borderColor: "var(--cor-borda)" }}
          >
            <summary
              className="cursor-pointer font-medium"
              style={{ color: "var(--cor-atencao)" }}
            >
              {foto.divergencias.length} divergência(s) registradas — não
              impedem a foto, mas precisam ser conferidas
            </summary>
            <ul className="mt-2 flex flex-col gap-1 text-xs">
              {foto.divergencias.map((d, i) => (
                <li key={i}>
                  <strong>{d.nome}</strong> · {d.campo}: {d.mensagem}
                </li>
              ))}
            </ul>
          </details>
        )}
        {clientes.length > 0 && (
          <>
            <input
              className="campo max-w-sm"
              placeholder="Filtrar por cliente ou CNPJ"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              aria-label="Filtrar clientes"
            />
            <TabelaResponsiva<(typeof visiveis)[number]>
              rotulo="Clientes da foto"
              linhas={visiveis}
              chave={(c) => c.documento}
              estiloLinha={(c) => (c.situacao === "SAIU" ? { opacity: 0.6 } : undefined)}
              colunas={[
                {
                  chave: "cliente",
                  titulo: "Cliente",
                  principal: true,
                  classe: "min-w-[200px]",
                  render: (c) => (
                    <>
                      {c.clienteId ? (
                        <Link to={`/clientes/${c.clienteId}`} className="font-medium underline-offset-2 hover:underline" style={{ color: "var(--cor-primaria)" }}>
                          {c.nome}
                        </Link>
                      ) : (
                        <span className="font-medium" style={{ color: "var(--cor-primaria)" }}>
                          {c.nome}
                        </span>
                      )}
                      <span className="block text-[11px] font-normal" style={{ color: "var(--cor-texto-secundario)" }}>
                        {c.documento}
                        {c.situacao === "NOVO" && anterior ? " · entrou nesta foto" : ""}
                        {c.situacao === "SAIU" ? " · saiu da foto (Normal ou sem risco no Bitfin)" : ""}
                      </span>
                    </>
                  ),
                },
                {
                  chave: "situacao",
                  titulo: "Situação",
                  render: (c) => (
                    <>
                      {c.situacao === "SAIU" ? <span className="text-xs">Fora da foto</span> : <StatusBadge status={c.status} />}
                      {c.statusAnterior && c.statusAnterior !== c.status && c.situacao !== "SAIU" && (
                        <span className="block text-[11px]" style={{ color: "var(--cor-texto-secundario)" }}>
                          era {c.statusAnterior}
                        </span>
                      )}
                    </>
                  ),
                },
                { chave: "risco", titulo: "Risco", alinhar: "right", classe: "numeros-tabulares whitespace-nowrap", render: (c) => <>{formatarMoeda(c.risco)}{variacao(c.risco, c.riscoAnterior)}</> },
                { chave: "vencido", titulo: "Vencido", alinhar: "right", classe: "numeros-tabulares whitespace-nowrap", render: (c) => <>{formatarMoeda(c.vencido)}{variacao(c.vencido, c.vencidoAnterior)}</> },
                { chave: "il30", titulo: "IL 30", alinhar: "right", classe: "numeros-tabulares whitespace-nowrap", render: (c) => formatarPercentualOpcional(c.il30, 2, "Sem base") },
                { chave: "limite", titulo: "Limite", alinhar: "right", ocultar: "lg", classe: "numeros-tabulares whitespace-nowrap", render: (c) => (c.situacao === "SAIU" ? "—" : formatarMoeda(c.limite)) },
                { chave: "andamento", titulo: "Em andamento", alinhar: "right", ocultar: "xl", classe: "numeros-tabulares whitespace-nowrap", render: (c) => (c.situacao === "SAIU" ? "—" : formatarMoeda(c.emAndamento)) },
                { chave: "prazo", titulo: "Prazo médio", alinhar: "right", ocultar: "xl", classe: "numeros-tabulares whitespace-nowrap", render: (c) => (c.prazoMedio === null ? "Sem operação" : formatarDias(c.prazoMedio)) },
                { chave: "eventos", titulo: "Eventos (7 dias)", alinhar: "right", ocultar: "lg", classe: "numeros-tabulares", render: (c) => c.eventos || "—" },
              ]}
            />
          </>
        )}
      </div>
    </Painel>
  );
}
