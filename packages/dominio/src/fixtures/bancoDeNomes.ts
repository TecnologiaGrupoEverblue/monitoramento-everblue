/** Bancos de nomes fictícios para geração de dados de demonstração.
 * Nenhum dado aqui corresponde a empresas ou pessoas reais. */

export const NOMES_GERENTES = [
  'Ana Beatriz Ferreira',
  'Carlos Eduardo Lima',
  'Marina Souza Prado',
  'Rodrigo Almeida Nunes',
  'Fernanda Castro Ribeiro',
]

export const NOMES_PLATAFORMAS = ['Plataforma Vega Comercial', 'Plataforma Órion Multicanal', 'Plataforma Atlas Corporate']

export const PREFIXOS_GRUPO = [
  'Grupo Cedro',
  'Grupo Bracatinga',
  'Grupo Ipê Dourado',
  'Grupo Araucária',
  'Grupo Jequitibá',
  'Grupo Sabiá',
  'Grupo Pindaíba',
  'Grupo Aroeira',
  'Grupo Canela Preta',
  'Grupo Jatobá',
  'Grupo Sucupira',
  'Grupo Guapuruvu',
  'Grupo Paineira',
  'Grupo Angico',
  'Grupo Mandacaru',
]

export const SUFIXOS_EMPRESA = [
  'Comércio de Alimentos Ltda',
  'Indústria e Distribuição S.A.',
  'Logística e Transportes Ltda',
  'Materiais de Construção S.A.',
  'Confecções e Têxtil Ltda',
  'Tecnologia e Sistemas S.A.',
  'Serviços Agropecuários Ltda',
  'Equipamentos Industriais S.A.',
  'Autopeças e Acessórios Ltda',
  'Farmacêutica e Insumos S.A.',
]

export const SETORES = [
  'Varejo',
  'Indústria',
  'Serviços',
  'Agronegócio',
  'Construção Civil',
  'Tecnologia',
  'Saúde',
  'Educação',
  'Logística',
  'Alimentos',
]

export const RAMOS_ATIVIDADE: Record<string, string[]> = {
  Varejo: ['Supermercados', 'Vestuário', 'Eletroeletrônicos', 'Materiais de Construção'],
  Indústria: ['Metalurgia', 'Química', 'Têxtil', 'Bens de Capital'],
  Serviços: ['Facilities', 'Consultoria', 'TI', 'Manutenção Industrial'],
  Agronegócio: ['Grãos', 'Pecuária', 'Insumos Agrícolas', 'Beneficiamento'],
  'Construção Civil': ['Incorporação', 'Materiais', 'Engenharia', 'Locação de Equipamentos'],
  Tecnologia: ['Software', 'Hardware', 'Telecom', 'E-commerce'],
  Saúde: ['Hospitalar', 'Farmacêutico', 'Equipamentos Médicos', 'Clínicas'],
  Educação: ['Ensino Superior', 'Cursos Livres', 'Material Didático', 'EAD'],
  Logística: ['Transporte Rodoviário', 'Armazenagem', 'Distribuição', 'Comércio Exterior'],
  Alimentos: ['Processamento', 'Distribuição Atacadista', 'Bebidas', 'Panificação'],
}

export const PRODUTOS = [
  'Antecipação de Recebíveis',
  'Desconto de Duplicatas',
  'Capital de Giro Garantido',
  'FIDC Cota Sênior',
  'FIDC Cota Subordinada',
]

export const RESPONSAVEIS_INTERNOS = [
  'Juliana Martins',
  'Pedro Henrique Costa',
  'Larissa Andrade',
  'Bruno Tavares',
  'Camila Rocha',
  'Diego Fontoura',
]

export const MOTIVOS_MONITORAMENTO = [
  'Aumento do vencido nas últimas semanas',
  'Queda relevante na liquidez de 30 dias',
  'Concentração elevada em poucos sacados',
  'Alteração de restritivos identificada',
  'Atraso reincidente no pagamento das parcelas',
]

export const MOTIVOS_SAIDA_DE_RISCO = [
  'Deterioração continuada mesmo após plano de ação',
  'Decisão do comitê por redução preventiva de exposição',
  'Mudança no perfil de risco do setor de atuação',
  'Concentração excessiva de risco no grupo econômico',
  'Sinais de dificuldade financeira identificados pela análise',
]

export const MOTIVOS_JURIDICO = [
  'Inadimplência superior a 90 dias sem negociação',
  'Recusa formal de negociação extrajudicial',
  'Descumprimento de acordo de parcelamento',
  'Identificação de fraude em manifesto',
]

export const MEDIDAS_JURIDICAS = [
  'Notificação extrajudicial enviada',
  'Ação de execução protocolada',
  'Acordo judicial em negociação',
  'Penhora de recebíveis solicitada',
]

export const MOTIVOS_RECOMPRA = [
  'Sacado contestou a duplicata',
  'Erro de lastro identificado no manifesto',
  'Inadimplência confirmada do sacado',
  'Duplicata cancelada pelo cedente',
]

export const DECISOES_COMITE = [
  'Manter em monitoramento com revisão quinzenal',
  'Reduzir limite de exposição em 20%',
  'Exigir garantias adicionais para novas operações',
  'Aprovar plano de regularização apresentado pelo cliente',
  'Encaminhar para jurídico caso não regularize em 15 dias',
  'Manter tranche atual, sem novas concessões',
]
