/**
 * Mapa de Garantias (1.2): o especialista escolhe os clientes pelo CNPJ e os
 * e-mails em cópia; o mapa é calculado sobre a última foto do Bitfin e sai por
 * e-mail todos os dias após a foto agendada (cada responsável recebe os seus
 * clientes; as cópias recebem todos).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  esquemaConfigMapaCliente,
  esquemaCpfCnpj,
  esquemaEmail,
  esquemaTextoMapa,
  lerValorBr,
} from "@monitoramento/dominio";
import { Download, Mail, Plus, Send, Trash2 } from "lucide-react";
import { Painel } from "../components/ui/Card";
import { useSessao } from "../contexts/SessaoContext";
import { ErroApi } from "../api/cliente";
import { mapaGarantiasRepository } from "../repositories";
import { Carregando, ErroCarga } from "../components/ui/EstadoCarga";
import { consultas, invalidar } from "../consultas";
import type {
  ConfigMapaCliente,
  EnvioMapa,
  LinhaMapaGarantia,
} from "../models/types";
import { formatarMoeda } from "../utils/formatters";

const dataHora = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo",
      })
    : "—";
const dataHoraBitfin = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "UTC",
      })
    : "—";
const pct = (v: number | null) =>
  v === null
    ? "—"
    : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const moeda = (v: number | null) => (v === null ? "—" : formatarMoeda(v));
const formatarDoc = (d: string) =>
  d.length === 14
    ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
    : d.length === 11
      ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
      : d;
const PAPEL: Record<string, string> = {
  GERENTE: "Gerente",
  ASSISTENTE: "Assistente",
  SUBGERENTE: "Subgerente",
  SUPERINTENDENTE: "Superintendente",
  DIRETOR: "Diretor",
  COPIA: "Cópia",
};
/** Entradas das listas: as mesmas regras que a API aplica (dominio/esquemas). */
const esquemaEntradaCliente = z.object({ valor: esquemaCpfCnpj });
const esquemaEntradaCopia = z.object({ valor: esquemaEmail });
type EsquemaEntrada = typeof esquemaEntradaCliente | typeof esquemaEntradaCopia;

/** Valor digitado no padrão brasileiro (1.234,56) → número, com o limite da API. */
const esquemaValorDeducao = z
  .string()
  .transform((v, ctx) => {
    const n = lerValorBr(v);
    if (n === null) {
      ctx.addIssue({ code: "custom", message: "Valor inválido (ex.: 1.234,56)." });
      return z.NEVER;
    }
    return n;
  })
  .pipe(esquemaConfigMapaCliente.shape.deducoes.element.shape.valor);
const textoOpcional = z
  .string()
  .trim()
  .transform((v) => v || null)
  .pipe(esquemaTextoMapa.nullable());
const esquemaFormConfig = z.object({
  contasGraficas: z.array(z.number().int().positive()),
  deducoes: z.array(
    z.object({ valor: esquemaValorDeducao, justificativa: esquemaTextoMapa }),
  ),
  concentracaoExcedida: textoOpcional,
  sacadoComRestricao: textoOpcional,
});
type FormConfigEntrada = z.input<typeof esquemaFormConfig>;
type FormConfig = z.output<typeof esquemaFormConfig>;

const STATUS_ENVIO: Record<
  EnvioMapa["status"],
  { texto: string; cor: string }
> = {
  ENVIADO: { texto: "Enviado", cor: "var(--cor-normal)" },
  FALHOU: { texto: "Falhou", cor: "var(--cor-critico)" },
  NAO_ENVIADO: { texto: "Não enviado", cor: "var(--cor-atencao)" },
};

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

export default function MapaGarantias() {
  const { pode } = useSessao();
  const clienteConsultas = useQueryClient();
  const telaQ = useQuery(consultas.telaMapa());
  const enviosQ = useQuery(consultas.enviosMapa());
  const tela = telaQ.data;
  const envios = enviosQ.data ?? [];
  const [mensagem, setMensagem] = useState<{
    tipo: "normal" | "critico" | "atencao";
    texto: string;
  } | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const podeEditar = pode("analista");

  // Toda alteração passa por aqui: grava, e a tela do mapa é buscada de novo.
  const acao = useMutation({
    mutationFn: (f: () => Promise<unknown>) => f(),
    onSettled: () => invalidar(clienteConsultas, "mapa"),
  });
  async function executar<T>(
    f: () => Promise<T>,
    sucesso?: string | ((r: T) => { tipo: "normal" | "atencao"; texto: string }),
  ) {
    setMensagem(null);
    try {
      const r = (await acao.mutateAsync(f)) as T;
      if (typeof sucesso === "string") setMensagem({ tipo: "normal", texto: sucesso });
      else if (sucesso) setMensagem(sucesso(r));
      return true;
    } catch (e) {
      setMensagem({
        tipo: "critico",
        texto: e instanceof ErroApi ? e.message : "Não foi possível concluir.",
      });
      return false;
    }
  }

  const envio = useMutation({
    mutationFn: mapaGarantiasRepository.enviar,
    onMutate: () => setMensagem(null),
    onSuccess: (r) =>
      setMensagem({
        tipo: r.falhas > 0 || r.naoEnviados > 0 ? "atencao" : "normal",
        texto: `Mapa enviado para ${r.enviados} destinatário(s)${r.falhas ? ` · ${r.falhas} falha(s)` : ""}${r.naoEnviados ? ` · ${r.naoEnviados} não enviado(s) (envio de e-mail desligado no servidor)` : ""}.`,
      }),
    onError: (e) =>
      setMensagem({
        tipo: "critico",
        texto: e instanceof ErroApi ? e.message : "Não foi possível enviar.",
      }),
    onSettled: () => invalidar(clienteConsultas, "mapa"),
  });
  const enviando = envio.isPending;

  if (telaQ.isError)
    return <ErroCarga erro={telaQ.error} aoTentarDeNovo={() => void telaQ.refetch()} />;
  if (!tela) return <Carregando />;
  const { calculado } = tela;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1
          className="fonte-editorial text-2xl font-semibold"
          style={{ color: "var(--cor-primaria)" }}
        >
          Mapa de Garantias
        </h1>
        <p className="text-sm" style={{ color: "var(--cor-texto-secundario)" }}>
          Calculado sobre a última foto do Bitfin e enviado por e-mail todos os
          dias após a foto agendada: gerente, assistente e superiores do
          cadastro do cliente no Bitfin recebem os seus clientes; os e-mails em
          cópia recebem todos.
        </p>
      </div>

      {!tela.envioLigado && (
        <Aviso tipo="atencao">
          O envio automático de e-mail ainda não foi ligado no servidor
          (CONFIGURAR-EMAIL). Os clientes e as cópias cadastrados aqui ficam
          valendo: até lá, o mapa é calculado e cada envio fica registrado como
          "não enviado".
        </Aviso>
      )}
      {mensagem && <Aviso tipo={mensagem.tipo}>{mensagem.texto}</Aviso>}

      <Painel titulo="Situação">
        <div className="flex flex-col gap-3 text-sm">
          <p style={{ color: "var(--cor-texto-primario)" }}>
            {calculado
              ? `Foto do Bitfin de ${dataHora(calculado.tiradaEm)}${calculado.apuradoEm ? ` (apuração ${dataHoraBitfin(calculado.apuradoEm)})` : ""} · ${calculado.linhas.length} cliente(s) no mapa.`
              : "Nenhuma foto do Bitfin leu o mapa ainda. Inclua os clientes abaixo e tire uma foto (ou aguarde a agendada)."}
          </p>
          {calculado && calculado.aguardandoFoto.length > 0 && (
            <p className="text-xs" style={{ color: "var(--cor-atencao)" }}>
              Incluído(s) depois desta foto — entra(m) na próxima:{" "}
              {calculado.aguardandoFoto.map(formatarDoc).join(", ")}
            </p>
          )}
          {calculado && calculado.naoEncontrados.length > 0 && (
            <p className="text-xs" style={{ color: "var(--cor-critico)" }}>
              Não encontrado(s) no Bitfin (confira o CNPJ):{" "}
              {calculado.naoEncontrados
                .map((n) => (/^\d+$/.test(n) ? formatarDoc(n) : n))
                .join(", ")}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="botao-primario inline-flex items-center gap-2"
              onClick={() => envio.mutate()}
              disabled={
                !podeEditar ||
                enviando ||
                !calculado ||
                calculado.linhas.length === 0
              }
            >
              <Send size={16} aria-hidden />{" "}
              {enviando ? "Enviando…" : "Enviar agora"}
            </button>
            {calculado && (
              <a
                className="botao-secundario inline-flex items-center gap-2"
                href={mapaGarantiasRepository.urlPdf}
              >
                <Download size={16} aria-hidden /> Baixar PDF
              </a>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={tela.envioDiarioAtivo}
                disabled={!pode("admin")}
                onChange={(e) =>
                  void executar(
                    () =>
                      mapaGarantiasRepository.definirEnvioDiario(
                        e.target.checked,
                      ),
                    e.target.checked
                      ? "Envio diário ligado."
                      : "Envio diário desligado.",
                  )
                }
              />
              Envio diário automático (após a foto agendada)
            </label>
          </div>
        </div>
      </Painel>

      <div className="grid gap-4 lg:grid-cols-2">
        <PainelLista
          titulo={`Clientes do mapa (${tela.clientes.length})`}
          placeholder="CPF ou CNPJ do cliente"
          rotuloBotao="Incluir"
          itens={tela.clientes.map((c) => ({
            chave: c.documento,
            titulo: `${formatarDoc(c.documento)} — ${
              c.nome ??
              (calculado?.naoEncontrados.some((n) => n.includes(c.documento))
                ? "não encontrado no Bitfin"
                : "nome pendente (vem na próxima foto)")
            }`,
            subtitulo: `incluído por ${c.incluidoPor ?? "—"} em ${dataHora(c.incluidoEm)}`,
          }))}
          podeEditar={podeEditar}
          aoIncluir={(v) =>
            executar(
              () => mapaGarantiasRepository.incluirCliente(v),
              (r) =>
                r.aviso
                  ? { tipo: "atencao", texto: `Cliente incluído. ${r.aviso}` }
                  : {
                      tipo: "normal",
                      texto: `${r.nome ?? "Cliente"} incluído. Entra no mapa a partir da próxima foto.`,
                    },
            )
          }
          aoRemover={(k) =>
            executar(
              () => mapaGarantiasRepository.removerCliente(k),
              "Cliente removido do mapa.",
            )
          }
          tipoEntrada="text"
          esquema={esquemaEntradaCliente}
        />
        <PainelLista
          titulo={`E-mails em cópia (${tela.copias.length})`}
          placeholder="nome@grupoeverblue.com.br"
          rotuloBotao="Incluir"
          itens={tela.copias.map((c) => ({
            chave: c.email,
            titulo: c.email,
            subtitulo: `incluído por ${c.incluidoPor ?? "—"} em ${dataHora(c.incluidoEm)}`,
          }))}
          podeEditar={podeEditar}
          aoIncluir={(v) =>
            executar(
              () => mapaGarantiasRepository.incluirCopia(v),
              "E-mail incluído nas cópias.",
            )
          }
          aoRemover={(k) =>
            executar(
              () => mapaGarantiasRepository.removerCopia(k),
              "E-mail removido das cópias.",
            )
          }
          tipoEntrada="email"
          esquema={esquemaEntradaCopia}
        />
      </div>

      {calculado && calculado.linhas.length > 0 && (
        <Painel titulo="Mapa (clique no cliente para ajustar contas gráficas e campos manuais)">
          <div
            className="max-h-[640px] overflow-auto border"
            style={{ borderColor: "var(--cor-borda)" }}
          >
            <table className="w-full min-w-[1200px] text-sm">
              <thead
                className="sticky top-0 border-b bg-[var(--cor-superficie-solida)] text-[11.5px] font-medium"
                style={{
                  color: "var(--cor-texto-secundario)",
                  borderColor: "var(--cor-borda-forte)",
                }}
              >
                <tr>
                  {[
                    "Cliente",
                    "Fundo",
                    "Risco NC",
                    "% Exig.",
                    "Exigibilidade",
                    "Cob. vinculada",
                    "Vencidos (vagão)",
                    "Manifesto",
                    "Prorrogados",
                    "Ded. manuais",
                    "Válidas",
                    "Contas gráficas",
                    "Garantia total",
                    "Sobra / falta",
                    "Cobertura",
                    "ILM 30",
                  ].map((t, i) => (
                    <th
                      key={t}
                      className={`px-2 py-2 ${i < 2 ? "text-left" : "text-right"} whitespace-nowrap ${i === 0 ? "min-w-[220px]" : ""}`}
                    >
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {calculado.linhas.map((l) => {
                  const doc = l.documento
                    .replace(/\D/g, "")
                    .replace(/^0(\d{14})$/, "$1");
                  return (
                    <LinhaMapa
                      key={doc}
                      linha={l}
                      documento={doc}
                      aberta={aberto === doc}
                      aoAlternar={() =>
                        setAberto((a) => (a === doc ? null : doc))
                      }
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
          {(() => {
            const l = calculado.linhas.find(
              (x) =>
                x.documento.replace(/\D/g, "").replace(/^0(\d{14})$/, "$1") ===
                aberto,
            );
            if (!l || !aberto) return null;
            return (
              <div
                className="mt-3 rounded-lg border p-3"
                style={{ borderColor: "var(--cor-borda-forte)" }}
              >
                <p
                  className="mb-2 font-semibold"
                  style={{ color: "var(--cor-primaria)" }}
                >
                  {l.nome}
                </p>
                <EdicaoCliente
                  key={aberto}
                  linha={l}
                  config={tela.configs[aberto]}
                  podeEditar={podeEditar}
                  aoSalvar={(c) =>
                    executar(
                      () => mapaGarantiasRepository.salvarConfig(aberto, c),
                      "Ajustes salvos.",
                    )
                  }
                />
              </div>
            );
          })()}
          <p
            className="mt-2 text-xs"
            style={{ color: "var(--cor-texto-secundario)" }}
          >
            Garantias válidas = cobrança vinculada − vencidos (efeito vagão:
            todo o saldo dos sacados com algum título vencido) − manifesto
            (lastro inconsistente, transação desconhecida e não concluída, fora
            do vagão) − prorrogados − deduções manuais. Garantia total = válidas
            + contas gráficas. Outras garantias não entram. Cada título é
            deduzido uma única vez. ILM fora do cálculo por enquanto.
          </p>
        </Painel>
      )}

      <Painel titulo={`Envios (${envios.length})`}>
        {enviosQ.isError ? (
          <ErroCarga erro={enviosQ.error} aoTentarDeNovo={() => void enviosQ.refetch()} />
        ) : envios.length === 0 ? (
          <p
            className="py-4 text-center text-sm"
            style={{ color: "var(--cor-texto-secundario)" }}
          >
            Nenhum envio ainda.
          </p>
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead
                className="border-b text-[12px]"
                style={{
                  color: "var(--cor-texto-secundario)",
                  borderColor: "var(--cor-borda-forte)",
                }}
              >
                <tr>
                  <th className="px-2 py-2 text-left">Quando</th>
                  <th className="px-2 py-2 text-left">Destinatário</th>
                  <th className="px-2 py-2 text-left">Papel</th>
                  <th className="px-2 py-2 text-right">Clientes</th>
                  <th className="px-2 py-2 text-left">Situação</th>
                </tr>
              </thead>
              <tbody>
                {envios.map((e) => (
                  <tr
                    key={e.id}
                    className="border-t"
                    style={{ borderColor: "var(--cor-borda)" }}
                  >
                    <td className="numeros-tabulares px-2 py-1.5 whitespace-nowrap">
                      {dataHora(e.em)}
                      <span
                        className="block text-[11px]"
                        style={{ color: "var(--cor-texto-secundario)" }}
                      >
                        {e.origem === "AGENDADO"
                          ? "Diário"
                          : `Manual · ${e.solicitadoPorNome ?? "—"}`}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 break-all">
                      <Mail size={12} className="mr-1 inline" aria-hidden />
                      {e.destinatario}
                    </td>
                    <td className="px-2 py-1.5">
                      {e.papeis.map((p) => PAPEL[p] ?? p).join(", ")}
                    </td>
                    <td className="numeros-tabulares px-2 py-1.5 text-right">
                      {e.clientes.length}
                    </td>
                    <td className="px-2 py-1.5">
                      <span
                        className="font-semibold"
                        style={{ color: STATUS_ENVIO[e.status].cor }}
                      >
                        {STATUS_ENVIO[e.status].texto}
                      </span>
                      {e.mensagem && (
                        <span
                          className="block text-[11px]"
                          style={{ color: "var(--cor-texto-secundario)" }}
                        >
                          {e.mensagem}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Painel>
    </div>
  );
}

function PainelLista({
  titulo,
  placeholder,
  rotuloBotao,
  itens,
  podeEditar,
  aoIncluir,
  aoRemover,
  tipoEntrada,
  esquema,
}: {
  titulo: string;
  placeholder: string;
  rotuloBotao: string;
  itens: { chave: string; titulo: string; subtitulo: string }[];
  podeEditar: boolean;
  aoIncluir: (v: string) => Promise<boolean>;
  aoRemover: (k: string) => Promise<boolean>;
  tipoEntrada: "text" | "email";
  esquema: EsquemaEntrada;
}) {
  const { register, handleSubmit, reset, control, formState } = useForm<
    { valor: string },
    unknown,
    { valor: string }
  >({ resolver: zodResolver(esquema), defaultValues: { valor: "" } });
  const valor = useWatch({ control, name: "valor" });
  const ocupado = formState.isSubmitting;
  const erroCampo = formState.errors.valor?.message;
  const incluir = handleSubmit(async ({ valor: v }) => {
    if (await aoIncluir(v)) reset({ valor: "" });
  });
  return (
    <Painel titulo={titulo} className="min-w-0">
      {podeEditar && (
        <form className="mb-3 flex flex-wrap gap-2" onSubmit={(e) => void incluir(e)} noValidate>
          <input
            className="campo min-w-0 flex-1"
            type={tipoEntrada}
            inputMode={tipoEntrada === "text" ? "numeric" : "email"}
            placeholder={placeholder}
            {...register("valor")}
            aria-label={placeholder}
            aria-invalid={Boolean(erroCampo)}
            maxLength={200}
          />
          <button
            className="botao-primario inline-flex items-center gap-1"
            type="submit"
            disabled={ocupado || !valor.trim()}
          >
            <Plus size={16} aria-hidden /> {rotuloBotao}
          </button>
          {erroCampo && (
            <p className="w-full text-xs" role="alert" style={{ color: "var(--cor-critico)" }}>
              {erroCampo}
            </p>
          )}
        </form>
      )}
      {itens.length === 0 ? (
        <p
          className="py-3 text-center text-sm"
          style={{ color: "var(--cor-texto-secundario)" }}
        >
          Nenhum ainda.
        </p>
      ) : (
        <ul className="flex max-h-[320px] flex-col overflow-auto">
          {itens.map((i) => (
            <li
              key={i.chave}
              className="flex items-center justify-between gap-2 border-t py-2 text-sm"
              style={{ borderColor: "var(--cor-borda)" }}
            >
              <div className="min-w-0">
                <p
                  className="break-words font-medium"
                  style={{ color: "var(--cor-primaria)" }}
                  title={i.titulo}
                >
                  {i.titulo}
                </p>
                <p
                  className="truncate text-[11px]"
                  style={{ color: "var(--cor-texto-secundario)" }}
                >
                  {i.subtitulo}
                </p>
              </div>
              {podeEditar && (
                <button
                  className="botao-secundario min-h-[40px] min-w-[44px] px-2"
                  onClick={() => void aoRemover(i.chave)}
                  aria-label={`Remover ${i.titulo}`}
                >
                  <Trash2 size={16} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Painel>
  );
}

function LinhaMapa({
  linha: l,
  documento,
  aberta,
  aoAlternar,
}: {
  linha: LinhaMapaGarantia;
  documento: string;
  aberta: boolean;
  aoAlternar: () => void;
}) {
  const cor =
    l.sobraFalta === null
      ? undefined
      : l.sobraFalta < 0
        ? "var(--cor-critico)"
        : "var(--cor-normal)";
  const celula = "numeros-tabulares px-2 py-1.5 text-right whitespace-nowrap";
  return (
    <tr
      className="cursor-pointer border-t align-top hover:bg-[var(--cor-fundo-recuado)]"
      style={{ borderColor: "var(--cor-borda)" }}
      onClick={aoAlternar}
      aria-expanded={aberta}
    >
      <td className="px-2 py-1.5">
        <span className="font-medium" style={{ color: "var(--cor-primaria)" }}>
          {l.nome}
        </span>
        <span
          className="block text-[11px]"
          style={{ color: "var(--cor-texto-secundario)" }}
        >
          {formatarDoc(documento)}
          {l.divergencias.length > 0 && (
            <span style={{ color: "var(--cor-atencao)" }}>
              {" "}
              · {l.divergencias.length} a conferir
            </span>
          )}
        </span>
      </td>
      <td className="px-2 py-1.5 text-xs">{l.fundo}</td>
      <td className={celula}>{moeda(l.riscoNotaComercial)}</td>
      <td className={celula}>{pct(l.exigenciaPerc)}</td>
      <td className={celula}>{moeda(l.exigibilidade)}</td>
      <td className={celula}>{moeda(l.cobrancaVinculada)}</td>
      <td className={celula}>{moeda(l.efeitoVagao)}</td>
      <td className={celula}>{moeda(l.totalManifesto)}</td>
      <td className={celula}>{moeda(l.prorrogados)}</td>
      <td className={celula}>{moeda(l.deducoesManuais)}</td>
      <td className={celula}>{moeda(l.garantiasValidas)}</td>
      <td className={celula}>{moeda(l.totalContasGraficas)}</td>
      <td className={`${celula} font-semibold`}>{moeda(l.garantiaTotal)}</td>
      <td className={`${celula} font-semibold`} style={{ color: cor }}>
        {moeda(l.sobraFalta)}
      </td>
      <td className={celula}>{pct(l.coberturaPerc)}</td>
      <td className={celula}>{pct(l.ilm30)}</td>
    </tr>
  );
}

function EdicaoCliente({
  linha: l,
  config,
  podeEditar,
  aoSalvar,
}: {
  linha: LinhaMapaGarantia;
  config: ConfigMapaCliente | undefined;
  podeEditar: boolean;
  aoSalvar: (c: {
    contasGraficas: number[] | null;
    deducoes: { valor: number; justificativa: string }[];
    concentracaoExcedida: string | null;
    sacadoComRestricao: string | null;
  }) => Promise<boolean>;
}) {
  const { register, control, handleSubmit, setValue, formState } =
    useForm<FormConfigEntrada, unknown, FormConfig>({
      resolver: zodResolver(esquemaFormConfig),
      defaultValues: {
        contasGraficas: l.contasGraficas
          .filter((c) => c.incluida)
          .map((c) => c.contaCorrenteId),
        deducoes: (config?.deducoes ?? []).map((d) => ({
          valor: String(d.valor).replace(".", ","),
          justificativa: d.justificativa,
        })),
        concentracaoExcedida: config?.concentracaoExcedida?.texto ?? "",
        sacadoComRestricao: config?.sacadoComRestricao?.texto ?? "",
      },
    });
  const deducoes = useFieldArray({ control, name: "deducoes" });
  const contas = useWatch({ control, name: "contasGraficas" });
  const salvando = formState.isSubmitting;
  const erros = formState.errors;
  const erro =
    erros.deducoes?.root?.message ??
    (Array.isArray(erros.deducoes) && erros.deducoes.some(Boolean)
      ? "Cada dedução precisa de valor maior que zero e justificativa (mínimo 3 caracteres)."
      : null);
  const salvar = handleSubmit(async (dados) => {
    await aoSalvar(dados);
  });
  const campoInvalido = (i: number, c: "valor" | "justificativa") =>
    Boolean(Array.isArray(erros.deducoes) && erros.deducoes[i]?.[c]);

  const linhaTexto = "text-xs";
  return (
    <div className="grid gap-4 text-sm lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        <div>
          <p
            className="mb-1 text-xs font-semibold"
            style={{ color: "var(--cor-texto-secundario)" }}
          >
            Contas gráficas que entram na garantia
          </p>
          {l.contasGraficas.length === 0 && (
            <p className={linhaTexto}>Nenhuma conta gráfica no Bitfin.</p>
          )}
          {l.contasGraficas.map((c) => (
            <label
              key={c.contaCorrenteId}
              className="flex items-center gap-2 py-0.5"
            >
              <input
                type="checkbox"
                className="h-4 w-4"
                disabled={!podeEditar}
                checked={contas.includes(c.contaCorrenteId)}
                onChange={(e) =>
                  setValue(
                    "contasGraficas",
                    e.target.checked
                      ? [...contas, c.contaCorrenteId]
                      : contas.filter((x) => x !== c.contaCorrenteId),
                    { shouldDirty: true },
                  )
                }
              />
              <span className={linhaTexto}>
                {c.descricao} · {c.produto} ·{" "}
                <span className="numeros-tabulares">{moeda(c.saldo)}</span>
              </span>
            </label>
          ))}
        </div>
        <div>
          <p
            className="mb-1 text-xs font-semibold"
            style={{ color: "var(--cor-texto-secundario)" }}
          >
            Detalhe
          </p>
          <ul className={`${linhaTexto} flex flex-col gap-0.5`}>
            {l.manifesto.map((m) => (
              <li key={m.status}>
                {m.descricao} (fora do vagão): {moeda(m.valor)}
              </li>
            ))}
            <li>
              {l.sacadosNoVagao} sacado(s) com título vencido no efeito vagão
            </li>
            {l.responsaveis.map((r) => (
              <li key={`${r.papel}-${r.membroId}`}>
                {PAPEL[r.papel]}: {r.nome ?? "—"}{" "}
                {r.email ? `· ${r.email}` : "· sem e-mail"}{" "}
                {r.ativo ? "" : "(inativo, não recebe)"}
              </li>
            ))}
            {l.outrasGarantias.map((o, i) => (
              <li key={i}>
                Outra garantia (não soma): {o.tipo}
                {o.descricao ? ` — ${o.descricao}` : ""} · {moeda(o.valor)}
              </li>
            ))}
            {l.divergencias.map((d, i) => (
              <li key={i} style={{ color: "var(--cor-atencao)" }}>
                Conferir: {d}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <div>
          <p
            className="mb-1 text-xs font-semibold"
            style={{ color: "var(--cor-texto-secundario)" }}
          >
            Deduções manuais (com justificativa)
          </p>
          {deducoes.fields.map((d, i) => (
            <div key={d.id} className="mb-1 flex flex-wrap gap-2">
              <input
                className="campo w-36"
                inputMode="decimal"
                placeholder="Valor (R$)"
                {...register(`deducoes.${i}.valor`)}
                aria-invalid={campoInvalido(i, "valor")}
                disabled={!podeEditar}
                aria-label="Valor da dedução"
              />
              <input
                className="campo min-w-0 flex-1"
                placeholder="Justificativa"
                {...register(`deducoes.${i}.justificativa`)}
                aria-invalid={campoInvalido(i, "justificativa")}
                disabled={!podeEditar}
                maxLength={1000}
                aria-label="Justificativa da dedução"
              />
              {podeEditar && (
                <button
                  type="button"
                  className="botao-secundario min-h-[40px] min-w-[44px] px-2"
                  onClick={() => deducoes.remove(i)}
                  aria-label="Remover dedução"
                >
                  <Trash2 size={16} aria-hidden />
                </button>
              )}
            </div>
          ))}
          {(config?.deducoes ?? []).length > 0 && (
            <p
              className="text-[11px]"
              style={{ color: "var(--cor-texto-secundario)" }}
            >
              {(config?.deducoes ?? [])
                .map(
                  (d) =>
                    `${d.responsavel} em ${d.data.split("-").reverse().join("/")}`,
                )
                .join(" · ")}
            </p>
          )}
          {podeEditar && (
            <button
              type="button"
              className="botao-secundario mt-1 inline-flex items-center gap-1"
              onClick={() => deducoes.append({ valor: "", justificativa: "" })}
            >
              <Plus size={14} aria-hidden /> Dedução
            </button>
          )}
        </div>
        <label className="flex flex-col gap-1">
          <span
            className="text-xs font-semibold"
            style={{ color: "var(--cor-texto-secundario)" }}
          >
            Concentração excedida (POC)
          </span>
          <input
            className="campo"
            {...register("concentracaoExcedida")}
            aria-invalid={Boolean(erros.concentracaoExcedida)}
            disabled={!podeEditar}
            maxLength={1000}
            placeholder="Ex.: Sacado X com 35% (limite 30%)"
          />
          {erros.concentracaoExcedida && (
            <span className="text-xs" style={{ color: "var(--cor-critico)" }}>
              {erros.concentracaoExcedida.message}
            </span>
          )}
          {config?.concentracaoExcedida && (
            <span
              className="text-[11px]"
              style={{ color: "var(--cor-texto-secundario)" }}
            >
              {config.concentracaoExcedida.responsavel} em{" "}
              {config.concentracaoExcedida.data.split("-").reverse().join("/")}
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1">
          <span
            className="text-xs font-semibold"
            style={{ color: "var(--cor-texto-secundario)" }}
          >
            Sacado com restrição recente (Serasa)
          </span>
          <input
            className="campo"
            {...register("sacadoComRestricao")}
            aria-invalid={Boolean(erros.sacadoComRestricao)}
            disabled={!podeEditar}
            maxLength={1000}
            placeholder="Ex.: Sacado Y com protesto de R$ 50 mil"
          />
          {erros.sacadoComRestricao && (
            <span className="text-xs" style={{ color: "var(--cor-critico)" }}>
              {erros.sacadoComRestricao.message}
            </span>
          )}
          {config?.sacadoComRestricao && (
            <span
              className="text-[11px]"
              style={{ color: "var(--cor-texto-secundario)" }}
            >
              {config.sacadoComRestricao.responsavel} em{" "}
              {config.sacadoComRestricao.data.split("-").reverse().join("/")}
            </span>
          )}
        </label>
        {erro && <Aviso tipo="critico">{erro}</Aviso>}
        {podeEditar && (
          <div>
            <button
              className="botao-primario"
              onClick={() => void salvar()}
              disabled={salvando}
            >
              {salvando ? "Salvando…" : "Salvar ajustes"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
